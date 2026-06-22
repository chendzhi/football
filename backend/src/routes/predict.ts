import { Router } from 'express';
import prisma from '../db';
import { runPoissonSimulation, calibrateDistribution, computeDynamicMarketWeight } from '../simulation_v2';
import { computeInjuryPenalty } from '../feature';
import { RawTeamFeatures, RawOddsFeatures } from '../types';
import { VERSIONS } from '../version';
import { generateAINarrative } from '../services/ai_narrative';
import { predictLambdaV2, getLambdaUncertainty } from '../ml/lambdaPredictor_v2';
import { computeContextFeatures } from '../ml/contextFeatures';
import { computeAllAdvancedFeatures, computeRollingStats } from '../ml/advancedFeatures';
import { computeFullLambdaAdjustment } from '../ml/lambdaAdjuster';
import { computeLogLinearAdjustment } from '../ml/lambdaAdjuster_v3';
import { oddsToMarketLambda, fuseLambdas, type FusedLambda } from '../ml/marketLambdaFusion';
import { computeExpectedXI, lineupStrengthToLambda } from '../data/expectedXI';
import { collectESPNData, extractKeyFeatures, realLineupStrength, type ESPNMatchData, type ExtractedFeatures } from '../data/espnDataEngine';
import { statsToLambdaAdjustment } from '../data/espnStatsEngine';
import { fetchMatchWeather, getVenueData, computeWeatherAdjustment, type MatchWeather } from '../data/weatherScraper';
import { collectAllMatchContext, computeTravelData, computeTournamentContext, computeScheduleDensity, getRefereeImpact, computeSuspensionImpact, type AllMatchContext } from '../data/matchDataScraper';
import { collectRealMatchData, crossValidateWithMarket, clearRealDataCache, aggregateOdds, findReferee, type RealMatchData, type AggregatedOdds, type RealRefereeData, type PlayerGoalStats } from '../data/realDataEngine';

const router = Router();

router.get('/predict/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true }
    });

    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const homeStats = await prisma.teamStats.findFirst({ where: { teamId: match.homeTeamId } });
    const awayStats = await prisma.teamStats.findFirst({ where: { teamId: match.awayTeamId } });
    const latestOddsRecord = await prisma.odds.findFirst({ where: { matchId: match.id }, orderBy: { updatedAt: 'desc' } });
    const homeInjuries = await prisma.playerStats.findMany({
      where: { matchId: match.id, isInjured: true, player: { teamId: match.homeTeamId } },
      include: { player: true }
    });
    const awayInjuries = await prisma.playerStats.findMany({
      where: { matchId: match.id, isInjured: true, player: { teamId: match.awayTeamId } },
      include: { player: true }
    });

    const homePenalty = computeInjuryPenalty(homeInjuries);
    const awayPenalty = computeInjuryPenalty(awayInjuries);

    const homeFeatures: RawTeamFeatures = {
      eloRating: match.homeTeam.eloRating,
      expectedGoalsFor: homeStats?.expectedGoalsFor ?? 1.3,
      expectedGoalsAgst: homeStats?.expectedGoalsAgst ?? 1.2,
      formScore: homeStats?.formScore ?? 0.5,
      injuryPenalty: homePenalty
    };

    const awayFeatures: RawTeamFeatures = {
      eloRating: match.awayTeam.eloRating,
      expectedGoalsFor: awayStats?.expectedGoalsFor ?? 1.3,
      expectedGoalsAgst: awayStats?.expectedGoalsAgst ?? 1.2,
      formScore: awayStats?.formScore ?? 0.5,
      injuryPenalty: awayPenalty
    };

    const odds: RawOddsFeatures | null = latestOddsRecord
      ? {
          homeOdds: latestOddsRecord.currentHomeOdds,
          drawOdds: latestOddsRecord.currentDrawOdds,
          awayOdds: latestOddsRecord.currentAwayOdds
        }
      : null;

    // Compute odds features (market layer v2: implied + delta + velocity + pressure)
    let oddsDelta = 0;
    let oddsImplied = 0;
    let oddsVelocity = 0;
    let marketPressureIndex = 0;
    if (odds) {
      // oddsImplied: market-implied home win probability
      const margin = 1/odds.homeOdds + 1/odds.drawOdds + 1/odds.awayOdds;
      oddsImplied = (1/odds.homeOdds) / margin;

      // oddsDelta + oddsVelocity + MPI from odds history
      const oddsHistory = await prisma.oddsHistory.findMany({
        where: { matchId: match.id },
        orderBy: { timestamp: 'asc' }
      });
      if (oddsHistory.length >= 2) {
        const first = oddsHistory[0];
        const last = oddsHistory[oddsHistory.length - 1];
        const earliestMargin = 1/first.homeOdds + 1/first.drawOdds + 1/first.awayOdds;
        const earliestImplied = (1/first.homeOdds) / earliestMargin;
        const latestMargin = 1/odds.homeOdds + 1/odds.drawOdds + 1/odds.awayOdds;
        const latestImplied = (1/odds.homeOdds) / latestMargin;

        oddsDelta = parseFloat((latestImplied - earliestImplied).toFixed(4));

        // Velocity = delta / hours
        const hoursDiff = (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 3600000;
        oddsVelocity = hoursDiff > 0 ? parseFloat((oddsDelta / Math.max(hoursDiff, 1)).toFixed(4)) : 0;

        // MPI: log(odds_open/odds_current) ≈ market pressure direction + strength
        marketPressureIndex = parseFloat(
          (Math.log(first.homeOdds / Math.max(odds.homeOdds, 1.01)) * 0.5).toFixed(4)
        );
      }
    }

    // Compute feature diffs for snapshot
    const eloDiff = homeFeatures.eloRating - awayFeatures.eloRating;
    const xgDiff = homeFeatures.expectedGoalsFor - awayFeatures.expectedGoalsFor;
    const xgaDiff = homeFeatures.expectedGoalsAgst - awayFeatures.expectedGoalsAgst;
    const formDiff = homeFeatures.formScore - awayFeatures.formScore;
    const injuryDiff = homeFeatures.injuryPenalty - awayFeatures.injuryPenalty;

    // Tweaks from sandbox controller (optional)
    const tweaks = {
      homeMomentum: parseFloat(req.query.homeMomentum as string) || 1.0,
      awayFitness: parseFloat(req.query.awayFitness as string) || 1.0,
      refereeStrictness: parseFloat(req.query.refereeStrictness as string) || 1.0,
    };
    const useTweaks = tweaks.homeMomentum !== 1.0 || tweaks.awayFitness !== 1.0 || tweaks.refereeStrictness !== 1.0;
    const tweakedHome = { ...homeFeatures, expectedGoalsFor: homeFeatures.expectedGoalsFor * tweaks.homeMomentum * tweaks.refereeStrictness };
    const tweakedAway = { ...awayFeatures, expectedGoalsFor: awayFeatures.expectedGoalsFor / tweaks.homeMomentum, expectedGoalsAgst: awayFeatures.expectedGoalsAgst * tweaks.awayFitness };

    // ML λ (uses trained weights if available, otherwise defaults)
    // Model is trained async by auto-sync; don't block prediction waiting for training

    // Compute context features from real match data (non-blocking, fall-safe)
    let context = null;
    try {
      context = await computeContextFeatures(
        prisma,
        match.homeTeamId, match.awayTeamId,
        new Date(match.matchDate), match.groupName
      );
    } catch (e: any) {
      console.log('[predict] context features unavailable:', e.message);
    }

    // ── 全量场外特征收集 (5大类: 阵容/赛制/场地/战术/体能) ──
    let matchContext: AllMatchContext | null = null;
    let adjustmentResult: { homeMultiplier: number; awayMultiplier: number; details: any[] } | null = null;
    let weatherAdjustment: { homeAdj: number; awayAdj: number; details: string[] } | null = null;
    let weatherData: MatchWeather | null = null;

    try {
      // Collect all match context in parallel
      const [homeRolling, awayRolling, adv, venueData] = await Promise.all([
        computeRollingStats(prisma, match.homeTeamId, new Date(match.matchDate)),
        computeRollingStats(prisma, match.awayTeamId, new Date(match.matchDate)),
        computeAllAdvancedFeatures(prisma, match.homeTeamId, match.awayTeamId,
          new Date(match.matchDate), match.groupName, match.stage),
        Promise.resolve(getVenueData(match.homeTeamId)),
      ]);

      const { computeSeparatedStats, computeH2HDetail } = await import('../ml/advancedFeatures');
      const [homeSep, awaySep, h2h] = await Promise.all([
        computeSeparatedStats(prisma, match.homeTeamId, new Date(match.matchDate)),
        computeSeparatedStats(prisma, match.awayTeamId, new Date(match.matchDate)),
        computeH2HDetail(prisma, match.homeTeamId, match.awayTeamId),
      ]);

      // Full match context (travel, tournament, schedule, referee, suspensions, venue)
      matchContext = await collectAllMatchContext(
        prisma, match.homeTeamId, match.awayTeamId, match.id,
        new Date(match.matchDate), match.stage, match.groupName,
        match.homeTeamId + '_azteca'  // Use home team's stadium as venue
      );

      // Weather from Open-Meteo
      const matchDateStr = new Date(match.matchDate).toISOString().slice(0, 10);
      weatherData = await fetchMatchWeather(venueData.lat, venueData.lon, matchDateStr);
      if (weatherData) {
        weatherAdjustment = computeWeatherAdjustment(weatherData, venueData.altitude);
      }

      // Compute full λ adjustment (all 5 categories, 20+ factors)
      adjustmentResult = computeFullLambdaAdjustment({
        homeRolling, awayRolling, homeSep, awaySep, h2h,
        homePressure: adv.qualPressure,
        awayPressure: { ...adv.qualPressure, pressureScore: adv.qualPressure.opponentPressure, mustWin: false, canDraw: false, alreadyQualified: false, alreadyEliminated: false } as any,
        isKnockout: adv.isKnockout,
        isHome: true,
        travel: matchContext.travel,
        tournament: matchContext.tournament,
        schedule: matchContext.schedule,
        referee: matchContext.referee,
        suspensions: matchContext.suspensions,
        weather: weatherData,
        altitude: venueData.altitude,
        matchEvents: matchContext.matchEvents,
      });
    } catch (e: any) {
      console.log('[predict] advanced features unavailable:', e.message);
    }

    // V3: Pure statistical λ (ML model)
    const mlResult = predictLambdaV2({
      homeElo: homeFeatures.eloRating, awayElo: awayFeatures.eloRating,
      homeXG: homeFeatures.expectedGoalsFor, awayXG: awayFeatures.expectedGoalsFor,
      homeXGA: homeFeatures.expectedGoalsAgst, awayXGA: awayFeatures.expectedGoalsAgst,
      homeForm: homeFeatures.formScore, awayForm: awayFeatures.formScore,
      homeInjury: homeFeatures.injuryPenalty, awayInjury: awayFeatures.injuryPenalty,
      context,
    });

    // ── V3: Market Lambda Pre-Fusion ──
    // 赔率反推 λ 在特征修正前与统计 λ 融合
    let fusedLambda: FusedLambda = { homeLambda: mlResult.homeLambda, awayLambda: mlResult.awayLambda, statWeight: 1, marketWeight: 0, marketLambda: null, reason: '无赔率' };
    if (odds) {
      const actualHoursToKickoff = Math.max(0, (new Date(match.matchDate).getTime() - Date.now()) / 3600000);
      const mktLambda = oddsToMarketLambda(odds.homeOdds, odds.drawOdds, odds.awayOdds,
        mlResult.homeLambda, mlResult.awayLambda);
      const volatility = Math.min(Math.abs(oddsDelta) * 8, 0.8);
      fusedLambda = fuseLambdas(mlResult.homeLambda, mlResult.awayLambda, mktLambda,
        actualHoursToKickoff, volatility);
    }

    // Initialize adjusted lambdas from fusion (pre-adjustment baseline)
    let adjustedHomeLambda = fusedLambda.homeLambda;
    let adjustedAwayLambda = fusedLambda.awayLambda;

    // ── V3: ESPN Real Data — 阵容/红黄牌/裁判/门将/统计 ──
    let espnData: ESPNMatchData | null = null;
    let espnFeatures: ExtractedFeatures | null = null;
    let realLineupImpact: { homeAdj: number; awayAdj: number; reason: string } | null = null;
    let espnEventId: string | null = null;
    try {
      espnData = await collectESPNData(
        match.homeTeam.name, match.awayTeam.name,
        new Date(match.matchDate)
      );
      if (espnData && espnData.rosters.length >= 2) {
        espnFeatures = extractKeyFeatures(espnData);
        // Real GK data → adjust opponent λ
        if (espnFeatures.homeGoalKeeperSaves > 3) {
          adjustedAwayLambda *= 0.92; // strong GK suppresses opponent
        }
        if (espnFeatures.awayGoalKeeperSaves > 3) {
          adjustedHomeLambda *= 0.92;
        }
        // Real lineup strength from actual starters
        const homeLS = realLineupStrength(espnData.rosters[0]);
        const awayLS = realLineupStrength(espnData.rosters[1]);
        const lsDiff = homeLS.overall - awayLS.overall;
        const homeLSAdj = parseFloat((1 + lsDiff * 0.6).toFixed(3));
        const awayLSAdj = parseFloat((1 - lsDiff * 0.6).toFixed(3));
        adjustedHomeLambda *= homeLSAdj;
        adjustedAwayLambda *= awayLSAdj;
        realLineupImpact = {
          homeAdj: homeLSAdj, awayAdj: awayLSAdj,
          reason: `真实阵容: 主${espnFeatures.homeFormation}(${homeLS.overall}) vs 客${espnFeatures.awayFormation}(${awayLS.overall}) GK:${espnFeatures.homeGoalkeeper}/${espnFeatures.awayGoalkeeper}`,
        };
        // Update referee with real name
        if (espnFeatures.refereeName !== 'Unknown' && matchContext) {
          (matchContext as any).referee = {
            ...matchContext.referee,
            name: espnFeatures.refereeName,
          };
        }
        // Apply real team stats (xG, saves, shots, possession) to λ
        if (espnData.homeStats) {
          const adj = statsToLambdaAdjustment(espnData.homeStats, true);
          adjustedHomeLambda *= adj.attackAdj;
          adjustedAwayLambda *= adj.defenseAdj * adj.gkAdj;
        }
        if (espnData.awayStats) {
          const adj = statsToLambdaAdjustment(espnData.awayStats, false);
          adjustedAwayLambda *= adj.attackAdj;
          adjustedHomeLambda *= adj.defenseAdj * adj.gkAdj;
        }

      }
    } catch (e: any) {
      console.log('[predict] ESPN data failed:', e.message);
    }

    // ── V3: Expected XI fallback (when ESPN unavailable) ──
    let lineupImpact: { homeAdj: number; awayAdj: number; reason: string } | null = null;
    if (!realLineupImpact) {
      try {
        const [homeXI, awayXI] = await Promise.all([
          computeExpectedXI(prisma, match.homeTeamId,
            homeInjuries.map((p: any) => p.player?.name || '').filter(Boolean)),
          computeExpectedXI(prisma, match.awayTeamId,
            awayInjuries.map((p: any) => p.player?.name || '').filter(Boolean)),
        ]);
        lineupImpact = lineupStrengthToLambda(homeXI, awayXI);
      } catch (e: any) {
        console.log('[predict] Expected XI failed:', e.message);
      }
    }

    // ── V3: Log-Link GLM 对数线性建模 ──
    // ln(λ) = ln(fused_λ) + Σ w_i · ln(factor_i)
    let logLinearResult: { homeMultiplier: number; awayMultiplier: number; factors: any[] } | null = null;
    if (matchContext) {
      logLinearResult = computeLogLinearAdjustment({
        homeRolling: await computeRollingStats(prisma, match.homeTeamId, new Date(match.matchDate)).catch(() => ({ gf:1.3,ga:1.2,cleanSheets:0,unbeatenStreak:0,losingStreak:0,lastGoalDiff:0,n:0 })),
        awayRolling: await computeRollingStats(prisma, match.awayTeamId, new Date(match.matchDate)).catch(() => ({ gf:1.3,ga:1.2,cleanSheets:0,unbeatenStreak:0,losingStreak:0,lastGoalDiff:0,n:0 })),
        homeSep: { homeGF:1.3,homeGA:1.2,homeCleanSheets:0,awayGF:1.3,awayGA:1.2,awayCleanSheets:0 },
        awaySep: { homeGF:1.3,homeGA:1.2,homeCleanSheets:0,awayGF:1.3,awayGA:1.2,awayCleanSheets:0 },
        h2h: { meetings:0,goalDiff:0,avgTotalGoals:0,drawRate:0,last3Results:'' },
        homePressure: matchContext.tournament ? { mustWin:false,canDraw:false,alreadyQualified:false,alreadyEliminated:false,pressureScore:0.5,opponentPressure:0.5 } as any : { mustWin:false,canDraw:false,alreadyQualified:false,alreadyEliminated:false,pressureScore:0.5,opponentPressure:0.5 },
        awayPressure: { mustWin:false,canDraw:false,alreadyQualified:false,alreadyEliminated:false,pressureScore:0.5,opponentPressure:0.5 },
        isKnockout: matchContext.tournament?.isKnockout || false,
        isHome: true,
        travel: matchContext.travel,
        tournament: matchContext.tournament,
        schedule: matchContext.schedule,
        referee: matchContext.referee,
        suspensions: matchContext.suspensions,
        weather: weatherData,
        altitude: (matchContext as any)?.venue?.altitude || 0,
        matchEvents: matchContext.matchEvents,
        homeTopScorerMissing: lineupImpact ? false : false,
        awayTopScorerMissing: false,
        homeTopScorerGoals: 0,
        awayTopScorerGoals: 0,
      });
    }

    // Apply log-linear adjustment (uses already-initialized adjusted lambdas)
    if (logLinearResult) {
      const homeLog = Math.log(Math.max(fusedLambda.homeLambda, 0.05));
      const awayLog = Math.log(Math.max(fusedLambda.awayLambda, 0.05));
      adjustedHomeLambda = parseFloat(Math.exp(homeLog + (logLinearResult as any).totalLogAdjustment?.home || 0).toFixed(4));
      adjustedAwayLambda = parseFloat(Math.exp(awayLog + (logLinearResult as any).totalLogAdjustment?.away || 0).toFixed(4));
    }
    // Apply lineup strength
    if (lineupImpact) {
      adjustedHomeLambda *= lineupImpact.homeAdj;
      adjustedAwayLambda *= lineupImpact.awayAdj;
    }
    // Apply weather
    if (weatherAdjustment) {
      adjustedHomeLambda *= weatherAdjustment.homeAdj;
      adjustedAwayLambda *= weatherAdjustment.awayAdj;
    }
    // Soft clamp
    adjustedHomeLambda = Math.max(0.2, Math.min(6.0, adjustedHomeLambda));
    adjustedAwayLambda = Math.max(0.2, Math.min(6.0, adjustedAwayLambda));

    // ── V3: Market weight already applied in pre-fusion. Calibration no longer blends market. ──
    const marketWeight = fusedLambda.marketWeight;
    const calMarketWeight = 0; // Single entry: market already fused into λ
    let realData: RealMatchData | null = null;
    let playerAdjustments: any[] = [];
    let marketXVal: any = null;

    try {
      realData = await collectRealMatchData(
        match.homeTeamId, match.awayTeamId,
        odds?.homeOdds, odds?.drawOdds, odds?.awayOdds
      );

      // Adjust λ for top scorer absence
      const homeMissing = matchContext?.suspensions?.homeMissing || [];
      const awayMissing = matchContext?.suspensions?.awayMissing || [];
      const homeInjuredNames = homeInjuries.map((p: any) => p.player?.name || '');
      const awayInjuredNames = awayInjuries.map((p: any) => p.player?.name || '');

      if (realData.homeTopScorer && (homeMissing.length > 0 || homeInjuredNames.length > 0)) {
        // Check if top scorer is among missing
        const topscorerMissing = [...homeMissing, ...homeInjuredNames].some(
          (n: string) => n.toLowerCase().includes(realData!.homeTopScorer!.playerName.toLowerCase()) ||
            realData!.homeTopScorer!.playerName.toLowerCase().includes(n.toLowerCase())
        );
        if (topscorerMissing) {
          adjustedHomeLambda *= 0.85;
          playerAdjustments.push({
            factor: '射手缺阵',
            team: 'home',
            player: realData.homeTopScorer.playerName,
            goals: realData.homeTopScorer.goals,
            impact: 'λ -15%',
          });
        }
      }
      if (realData.awayTopScorer && (awayMissing.length > 0 || awayInjuredNames.length > 0)) {
        const topscorerMissing = [...awayMissing, ...awayInjuredNames].some(
          (n: string) => n.toLowerCase().includes(realData!.awayTopScorer!.playerName.toLowerCase()) ||
            realData!.awayTopScorer!.playerName.toLowerCase().includes(n.toLowerCase())
        );
        if (topscorerMissing) {
          adjustedAwayLambda *= 0.85;
          playerAdjustments.push({
            factor: '射手缺阵',
            team: 'away',
            player: realData.awayTopScorer.playerName,
            goals: realData.awayTopScorer.goals,
            impact: 'λ -15%',
          });
        }
      }

      // Market cross-validation
      if (realData.aggregatedOdds) {
        const baseOver25 = 1 - Math.exp(-(adjustedHomeLambda + adjustedAwayLambda) * 0.5);
        const baseBtts = 0.5;
        marketXVal = crossValidateWithMarket(
          mlResult.homeLambda, 0, mlResult.awayLambda, // rough estimates
          baseOver25, baseBtts, realData.aggregatedOdds
        );
      }

      // Real referee detection
      if (matchContext && !matchContext.referee?.name) {
        const ref = findReferee('');
        if (ref) {
          (matchContext as any).referee = {
            name: ref.name,
            strictness: ref.avgYellows / 8, // normalize
            goalImpact: parseFloat((1 + (0.5 - ref.avgYellows / 8) * 0.15).toFixed(3)),
          };
        }
      }
    } catch (e: any) {
      console.log('[predict] real data engine failed:', e.message);
    }

    // Re-clamp after player-level adjustments
    adjustedHomeLambda = Math.max(0.3, Math.min(5.0, adjustedHomeLambda));
    adjustedAwayLambda = Math.max(0.3, Math.min(5.0, adjustedAwayLambda));

    // Poisson simulation (V3: market already fused into λ, calibration is per-outcome only) — λ sampling with uncertainty propagation (seeded for reproducibility)
    const lambdaSigma = getLambdaUncertainty();
    const ciWidth = (mlResult.homeCI[1] - mlResult.homeCI[0]) / mlResult.homeLambda;
    // Derive deterministic seed from matchId (simple hash)
    const seed = matchId.split('').reduce((acc, c) => acc * 31 + c.charCodeAt(0), 0) & 0x7fffffff;
    const dist = runPoissonSimulation(adjustedHomeLambda, adjustedAwayLambda, eloDiff, lambdaSigma, ciWidth, seed);
    // Market blended ONLY at calibration layer (single entry)
    const calibrated = calibrateDistribution(dist, odds, calMarketWeight);

    // Build report (compatible with existing frontend)
    const report = {
      lambdas: dist.lambdas,
      probabilities: {
        homeWin: calibrated.homeWin,
        draw: calibrated.draw,
        awayWin: calibrated.awayWin,
        rawHomeWin: calibrated.rawHomeWin,
        rawDraw: calibrated.rawDraw,
        rawAwayWin: calibrated.rawAwayWin,
      },
      topScores: calibrated.topScores.map(s => ({ score: s.score, prob: s.prob.toString() })),
      over25Prob: calibrated.over25Prob,
      under25Prob: calibrated.under25Prob,
      spread: { line: Math.round((dist.lambdas.homeLambda - dist.lambdas.awayLambda) * 0.6 * 4) / 4, coverProb: 0.5 },
      confidence: calibrated.confidence,
      clusters: calibrated.clusters,
      xgTotal: dist.xgTotal,
      awayWinUnder25: dist.awayWinUnder25,
      awayWinUnder35: dist.awayWinUnder35,
      rho: dist.rho,
      matrixSize: dist.matrixSize,
      lambdaCI: { home: mlResult.homeCI, away: mlResult.awayCI },
      marketWeight,
      _scoreMap: Object.fromEntries(dist.scores.map(s => [`${s.h}-${s.a}`, Math.round(s.p * 10000)])),
    };

    // Build paths (score intervals from clusters)
    const paths = buildPaths(report);

    // Build radar
    const radar = buildRadar(match, homeStats, awayStats, homePenalty, awayPenalty);

    // Generate narrative
    const narrativeCache = new Map<string, string>();
    const cacheKey = `${matchId}_${useTweaks ? JSON.stringify(tweaks) : 'default'}`;
    if (!narrativeCache.has(cacheKey)) {
      narrativeCache.set(cacheKey, await generateAINarrative({
        homeName: match.homeTeam.name, awayName: match.awayTeam.name,
        homeLambda: dist.lambdas.homeLambda, awayLambda: dist.lambdas.awayLambda,
        homeProb: calibrated.homeWin * 100, drawProb: calibrated.draw * 100, awayProb: calibrated.awayWin * 100,
        topScores: calibrated.topScores.map((s: any) => ({ score: s.score, prob: s.prob.toString() })),
      }));
    }
    const narrative = narrativeCache.get(cacheKey) || '';

    // Persist (with full raw features for auditability)
    const snapshotId = `fs_${matchId}_${Date.now()}`;
    await prisma.featureSnapshot.create({
      data: {
        id: snapshotId, matchId: match.id,
        eloDiff, xgDiff, xgaDiff, formDiff, injuryDiff, oddsDelta,
        homeLambda: dist.lambdas.homeLambda, awayLambda: dist.lambdas.awayLambda,
        // Raw features for audit replay
        homeElo: homeFeatures.eloRating, awayElo: awayFeatures.eloRating,
        homeXG: homeFeatures.expectedGoalsFor, awayXG: awayFeatures.expectedGoalsFor,
        homeXGA: homeFeatures.expectedGoalsAgst, awayXGA: awayFeatures.expectedGoalsAgst,
        homeForm: homeFeatures.formScore, awayForm: awayFeatures.formScore,
        featureVersion: VERSIONS.feature, modelVersion: VERSIONS.model,
      }
    });

    const predictionId = `ph_${matchId}_${Date.now()}`;
    await prisma.predictionHistory.create({
      data: { id: predictionId, matchId: match.id, teamId: match.homeTeamId,
        predHomeWin: calibrated.homeWin, predDraw: calibrated.draw, predAwayWin: calibrated.awayWin,
        featureVersion: VERSIONS.feature, modelVersion: VERSIONS.model, simulationVersion: 'v5_poisson_matrix' }
    });

    const simMeta = {
      engine: 'Poisson Matrix 8x8 (No MC)',
      correction: 'Dixon-Coles rho=-0.25',
      calibration: 'Platt + Isotonic (per-outcome H/D/A)',
      marketBlend: odds ? 'dynamic trust (liquidity × time × stability)' : 'none',
      lambdaVersion: 'V3: Log-Link GLM + Market Pre-Fusion + Expected XI',
      baseLambda: { home: mlResult.homeLambda, away: mlResult.awayLambda },
      adjustedLambda: { home: parseFloat(adjustedHomeLambda.toFixed(4)), away: parseFloat(adjustedAwayLambda.toFixed(4)) },
      adjustments: adjustmentResult?.details || [],
      travel: matchContext ? {
        homeKm: matchContext.travel.homeDistanceKm,
        awayKm: matchContext.travel.awayDistanceKm,
        homeJetLag: matchContext.travel.homeJetLag,
        awayJetLag: matchContext.travel.awayJetLag,
      } : null,
      tournament: matchContext ? {
        stageWeight: matchContext.tournament.stageWeight,
        isKnockout: matchContext.tournament.isKnockout,
        collusionPossible: matchContext.tournament.collusionPossible,
        isGroupMatch3: matchContext.tournament.isGroupMatch3,
      } : null,
      schedule: matchContext ? {
        homeDaysSinceLast: matchContext.schedule.homeDaysSinceLast,
        awayDaysSinceLast: matchContext.schedule.awayDaysSinceLast,
        home3in7: matchContext.schedule.homeMatch3in7,
        away3in7: matchContext.schedule.awayMatch3in7,
      } : null,
      referee: matchContext ? {
        name: matchContext.referee.name,
        strictness: matchContext.referee.strictness,
        goalImpact: matchContext.referee.goalImpact,
      } : null,
      suspensions: matchContext ? {
        homeMissing: matchContext.suspensions.homeMissing,
        awayMissing: matchContext.suspensions.awayMissing,
      } : null,
      weather: weatherAdjustment?.details || [],
      venue: matchContext?.venue || null,
      formation: matchContext?.matchEvents?.formation || null,
      shots: matchContext?.matchEvents ? {
        home: matchContext.matchEvents.shotsOnTarget.home,
        away: matchContext.matchEvents.shotsOnTarget.away,
      } : null,
      playerData: realData ? {
        homeTopScorer: realData.homeTopScorer ? {
          name: realData.homeTopScorer.playerName,
          goals: realData.homeTopScorer.goals,
          gpm: realData.homeTopScorer.goalsPerMatch,
        } : null,
        awayTopScorer: realData.awayTopScorer ? {
          name: realData.awayTopScorer.playerName,
          goals: realData.awayTopScorer.goals,
          gpm: realData.awayTopScorer.goalsPerMatch,
        } : null,
        homeForm: realData.homeForm.formRating,
        awayForm: realData.awayForm.formRating,
      } : null,
      fusion: {
        statWeight: fusedLambda.statWeight,
        marketWeight: fusedLambda.marketWeight,
        marketLambda: fusedLambda.marketLambda ? {
          home: fusedLambda.marketLambda.homeLambda,
          away: fusedLambda.marketLambda.awayLambda,
          confidence: fusedLambda.marketLambda.confidence,
          liquidity: fusedLambda.marketLambda.liquidity,
        } : null,
        reason: fusedLambda.reason,
      },
      lineup: (realLineupImpact || lineupImpact) ? {
        homeAdj: (realLineupImpact || lineupImpact)!.homeAdj,
        awayAdj: (realLineupImpact || lineupImpact)!.awayAdj,
        reason: (realLineupImpact || lineupImpact)!.reason,
        source: realLineupImpact ? 'ESPN真实首发' : '预估首发',
      } : null,
      espnData: espnFeatures ? {
        formations: { home: espnFeatures.homeFormation, away: espnFeatures.awayFormation },
        goalkeepers: { home: espnFeatures.homeGoalkeeper, away: espnFeatures.awayGoalkeeper },
        gkSaves: { home: espnFeatures.homeGoalKeeperSaves, away: espnFeatures.awayGoalKeeperSaves },
        cards: {
          homeYellow: espnFeatures.homeYellowCards, awayYellow: espnFeatures.awayYellowCards,
          homeRed: espnFeatures.homeRedCards, awayRed: espnFeatures.awayRedCards,
        },
        goalContribs: { home: espnFeatures.homeGoalContributions, away: espnFeatures.awayGoalContributions },
        referee: espnFeatures.refereeName,
        venue: espnFeatures.venue,
        attendance: espnFeatures.attendance,
      } : null,
      playerAdjustments,
      marketXVal: marketXVal ? {
        over25Model: marketXVal.adjustedOver25,
        bttsModel: marketXVal.adjustedBtts,
        warning: marketXVal.warning,
      } : null,
      multiSourceOdds: realData?.aggregatedOdds ? {
        fairH: realData.aggregatedOdds.homeWin,
        fairD: realData.aggregatedOdds.draw,
        fairA: realData.aggregatedOdds.awayWin,
        over25Mkt: realData.aggregatedOdds.over25,
        liquidity: realData.aggregatedOdds.liquidity,
      } : null,
      oddsMonitoring: odds ? {
        implied: parseFloat((oddsImplied * 100).toFixed(1)),
        delta: oddsDelta,
        velocity: oddsVelocity,
        pressure: marketPressureIndex,
        live: oddsVelocity !== 0,
      } : null,
    };

    res.json({ matchId: match.id, report, paths, radar, narrative,
      tweaks: useTweaks ? tweaks : null, snapshotId, predictionId, simMeta });
  } catch (error: any) {
    console.error('[PREDICT]', error.message, error.stack?.split('\n')[1]);
    res.status(500).json({ error: 'Internal predictive engine error', detail: error.message });
  }
});

/** Build match script — score clusters (Poisson matrix, no MC) */
function buildPaths(report: any) {
  const c = report.clusters;
  const hProb = report.probabilities?.homeWin ?? 0;
  const aProb = report.probabilities?.awayWin ?? 0;

  return {
    main: {
      fullScore: aProb > hProb
        ? `客队胜 (1-2球 ${(c.narrowAway*100).toFixed(0)}% / 3+球 ${(c.bigAway*100).toFixed(0)}%)`
        : `主队胜 (1-2球 ${(c.narrowHome*100).toFixed(0)}% / 3+球 ${(c.bigHome*100).toFixed(0)}%)`,
      fullProb: parseFloat((aProb > hProb ? c.narrowAway + c.bigAway : c.narrowHome + c.bigHome).toFixed(3)),
    },
    backup: {
      fullScore: `平局 (${(c.draw*100).toFixed(0)}%)`,
      fullProb: parseFloat(c.draw.toFixed(3)),
    },
    variable: {
      fullScore: aProb > hProb
        ? `主队胜 (1-2球 ${(c.narrowHome*100).toFixed(0)}% / 3+球 ${(c.bigHome*100).toFixed(0)}%)`
        : `客队胜 (1-2球 ${(c.narrowAway*100).toFixed(0)}% / 3+球 ${(c.bigAway*100).toFixed(0)}%)`,
      fullProb: parseFloat((aProb > hProb ? c.narrowHome + c.bigHome : c.narrowAway + c.bigAway).toFixed(3)),
    },
    source: 'Poisson Matrix 8×8',
  };
}

/** Build 6-dim radar from REAL independent features [att, def, val, form, exp, fit] scaled to 0-100 */
function buildRadar(
  match: any,
  homeStats: any,
  awayStats: any,
  homeInjuryPenalty: number,
  awayInjuryPenalty: number
) {
  const h = match.homeTeam, a = match.awayTeam;
  const clamp = (v: number, min: number, max: number) =>
    Math.min(100, Math.max(0, Math.round(((v - min) / (max - min)) * 100)));

  // 6 independent dimensions from REAL data sources:
  // Dim1: 进攻火力 → expectedGoalsFor (xG per match, range 0-3)
  // Dim2: 防守抗压 → expectedGoalsAgst inverted (lower = better, range 0-3)
  // Dim3: 量化身价 → eloRating (tournament pedigree, range 1500-2200)
  // Dim4: 状态动量 → formScore (time-decay weighted recent goals, range 0-2)
  // Dim5: 大赛经验 → derived from eloRating + recent match count (range 0-1)
  // Dim6: 体能储备 → injuryPenalty inverted (lower penalty = fitter squad, range 0-0.3)

  const hs = homeStats || {};
  const as = awayStats || {};

  return {
    home: [
      clamp(hs.expectedGoalsFor ?? 1.3, 0, 3.0),           // 进攻火力: xG
      clamp(3.0 - (hs.expectedGoalsAgst ?? 1.2), 0, 3.0),  // 防守抗压: inverted xGA
      clamp(h.eloRating, 1500, 2200),                        // 量化身价: ELO
      clamp(hs.formScore ?? 0.5, 0, 2.0),                    // 状态动量: formScore
      clamp((h.eloRating - 1500) / 700 * 0.6 + (hs.formScore ?? 0.5) * 0.4, 0, 1.0), // 大赛经验: ELO + form blend
      clamp(1.0 - homeInjuryPenalty, 0.7, 1.0),             // 体能储备: injury inverted
    ],
    away: [
      clamp(as.expectedGoalsFor ?? 1.3, 0, 3.0),
      clamp(3.0 - (as.expectedGoalsAgst ?? 1.2), 0, 3.0),
      clamp(a.eloRating, 1500, 2200),
      clamp(as.formScore ?? 0.5, 0, 2.0),
      clamp((a.eloRating - 1500) / 700 * 0.6 + (as.formScore ?? 0.5) * 0.4, 0, 1.0),
      clamp(1.0 - awayInjuryPenalty, 0.7, 1.0),
    ],
    homeName: h.shortName || h.name,
    awayName: a.shortName || a.name,
  };
}

export default router;
