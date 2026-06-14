import { Router } from 'express';
import prisma from '../db';
import { runMonteCarloSimulation } from '../simulation';
import { computeInjuryPenalty } from '../feature';
import { RawTeamFeatures, RawOddsFeatures } from '../types';
import { VERSIONS } from '../version';
import { generateAINarrative } from '../services/ai_narrative';

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

    const report = runMonteCarloSimulation(useTweaks ? tweakedHome : homeFeatures, useTweaks ? tweakedAway : awayFeatures, odds);

    // Build paths (half-time → full-time script tree)
    const paths = buildPaths(report);

    // Build radar (6-dim features normalized to 0-100)
    const radar = buildRadar(match);

    // Generate narrative (cached if no tweaks, fresh if tweaks active)
    const narrativeCache = new Map<string, string>();
    const cacheKey = `${matchId}_${useTweaks ? JSON.stringify(tweaks) : 'default'}`;
    if (!narrativeCache.has(cacheKey)) {
      narrativeCache.set(cacheKey, await generateAINarrative({
        homeName: match.homeTeam.name, awayName: match.awayTeam.name,
        homeLambda: report.lambdas.homeLambda, awayLambda: report.lambdas.awayLambda,
        homeProb: report.probabilities.homeWin * 100, drawProb: report.probabilities.draw * 100, awayProb: report.probabilities.awayWin * 100,
        topScores: report.topScores,
      }));
    }
    const narrative = narrativeCache.get(cacheKey) || '';

    // Persist FeatureSnapshot
    const snapshotId = `fs_${matchId}_${Date.now()}`;
    await prisma.featureSnapshot.create({
      data: {
        id: snapshotId,
        matchId: match.id,
        eloDiff,
        xgDiff,
        xgaDiff,
        formDiff,
        injuryDiff,
        oddsDelta,
        homeLambda: report.lambdas.homeLambda,
        awayLambda: report.lambdas.awayLambda,
        featureVersion: VERSIONS.feature,
        modelVersion: VERSIONS.model
      }
    });

    // Persist PredictionHistory
    const predictionId = `ph_${matchId}_${Date.now()}`;
    await prisma.predictionHistory.create({
      data: {
        id: predictionId,
        matchId: match.id,
        teamId: match.homeTeamId,
        predHomeWin: report.probabilities.homeWin,
        predDraw: report.probabilities.draw,
        predAwayWin: report.probabilities.awayWin,
        featureVersion: VERSIONS.feature,
        modelVersion: VERSIONS.model,
        simulationVersion: VERSIONS.simulation
      }
    });

    res.json({
      matchId: match.id,
      report,
      paths,
      radar,
      narrative,
      tweaks: useTweaks ? tweaks : null,
      snapshotId,
      predictionId
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal predictive engine error' });
  }
});

/** Build half-time → full-time script tree from top scores */
function buildPaths(report: any) {
  const ts = report.topScores || [];
  const [main, backup, variable] = ts;
  return {
    main:    { halfScore: main?.score?.replace(/-.*/,'-0')||'1-0', halfProb: 0.24, fullScore: main?.score||'2-0' },
    backup:  { halfScore: backup?.score?.replace(/-.*/,'-0')||'0-0', halfProb: 0.35, fullScore: backup?.score||'1-1' },
    variable:{ halfScore: variable?.score?.replace(/-.*/,'-0')||'0-1', halfProb: 0.12, fullScore: variable?.score||'1-2' },
  };
}

/** Build 6-dim radar features [att, def, val, form, exp, fit] scaled to 0-100 */
function buildRadar(match: any) {
  const h = match.homeTeam, a = match.awayTeam;
  const clamp = (v: number, min: number, max: number) => Math.min(100, Math.max(0, Math.round((v-min)/(max-min)*100)));
  // 6 dimensions: Attack, Defense, Value, Form, Experience, Fitness
  return {
    home: [
      clamp(h.eloRating, 1600, 2200),        // 进攻火力
      clamp(2200 - h.eloRating, 0, 600),      // 防守抗压 (inverted ELO)
      clamp(h.eloRating, 1600, 2200),          // 量化身价
      clamp(1800 + (h.eloRating-1800)*0.5, 1600, 2200), // 状态动量
      clamp(1700 + (h.eloRating-1700)*0.3, 1600, 2200), // 大赛经验
      clamp(1900 + (h.eloRating-1900)*0.7, 1600, 2200), // 体能储备
    ],
    away: [
      clamp(a.eloRating, 1600, 2200),
      clamp(2200 - a.eloRating, 0, 600),
      clamp(a.eloRating, 1600, 2200),
      clamp(1800 + (a.eloRating-1800)*0.5, 1600, 2200),
      clamp(1700 + (a.eloRating-1700)*0.3, 1600, 2200),
      clamp(1900 + (a.eloRating-1900)*0.7, 1600, 2200),
    ],
    homeName: h.shortName || h.name, awayName: a.shortName || a.name,
  };
}

export default router;
