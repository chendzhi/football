/**
 * Predict Route V4 — 统一建模 + 残差学习
 *
 * λ 只在 UnifiedPredictor 中计算一次，不再经过多层叠加。
 */

import { Router } from 'express';
import prisma from '../db';
import { runPoissonSimulation, calibrateDistribution } from '../simulation_v2';
import { computeInjuryPenalty } from '../feature';
import { RawTeamFeatures, RawOddsFeatures } from '../types';
import { VERSIONS } from '../version';
import { generateAINarrative } from '../services/ai_narrative';
import { predictUnified, type UnifiedFeatures } from '../ml/unifiedPredictor';
import { oddsToMarketLambda, fuseLambdas } from '../ml/marketLambdaFusion';
import { loadErrorHistory, recordPrediction, applyResidualCorrection } from '../ml/residualLearner';

const router = Router();

// Load residual history on startup
loadErrorHistory(prisma).catch(() => {});

router.get('/predict/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true },
    });
    if (!match) return res.status(404).json({ error: 'Match not found' });

    // ── Step 1: Data ──
    const [homeStats, awayStats, latestOdds, homeInjuries, awayInjuries] = await Promise.all([
      prisma.teamStats.findFirst({ where: { teamId: match.homeTeamId } }),
      prisma.teamStats.findFirst({ where: { teamId: match.awayTeamId } }),
      prisma.odds.findFirst({ where: { matchId: match.id }, orderBy: { updatedAt: 'desc' } }),
      prisma.playerStats.findMany({ where: { matchId: match.id, isInjured: true, player: { teamId: match.homeTeamId } }, include: { player: true } }),
      prisma.playerStats.findMany({ where: { matchId: match.id, isInjured: true, player: { teamId: match.awayTeamId } }, include: { player: true } }),
    ]);

    const homePenalty = computeInjuryPenalty(homeInjuries);
    const awayPenalty = computeInjuryPenalty(awayInjuries);

    const homeElo = match.homeTeam.eloRating;
    const awayElo = match.awayTeam.eloRating;
    const homeXG = homeStats?.expectedGoalsFor ?? 1.3;
    const awayXG = awayStats?.expectedGoalsFor ?? 1.3;
    const homeXGA = homeStats?.expectedGoalsAgst ?? 1.2;
    const awayXGA = awayStats?.expectedGoalsAgst ?? 1.2;
    const homeForm = homeStats?.formScore ?? 0.5;
    const awayForm = awayStats?.formScore ?? 0.5;

    const odds: RawOddsFeatures | null = latestOdds
      ? { homeOdds: latestOdds.currentHomeOdds, drawOdds: latestOdds.currentDrawOdds, awayOdds: latestOdds.currentAwayOdds }
      : null;

    // ── Step 2: Build Unified Feature Vector ──
    const safeLog = (x: number) => Math.log(Math.max(x, 0.01));

    const features: UnifiedFeatures = {
      // Core
      eloDiff: homeElo - awayElo,
      xGDiff: homeXG - awayXG,
      xGADiff: homeXGA - awayXGA,
      formDiff: homeForm - awayForm,
      injuryDiff: homePenalty - awayPenalty,
      homeAdvantage: 1.0,

      // Interaction (simplified — tanh normalized)
      eloXForm: Math.tanh((homeElo - awayElo) / 400) * Math.tanh(homeForm - awayForm),
      xgXRest: 0,
      motXDef: 0,
      eloXxg: Math.tanh((homeElo - awayElo) / 400) * Math.tanh(homeXG - awayXG),

      // Context
      restAdv: 0,
      h2hAdv: 0,
      motivation: 0,

      // 5-category adjustments (all start at 0 → ln(1)=0, no effect unless data available)
      travelLog: 0,
      pressureLog: 0,
      knockoutLog: 0,
      collusionLog: 0,
      altitudeLog: 0,
      weatherLog: 0,
      refereeLog: 0,
      defenseLog: 0,
      cleanSheetLog: 0,
      h2hLog: 0,
      psychLog: 0,
      streakLog: 0,
      scheduleLog: 0,
      groupMatch3Log: 0,
      homeFormLog: 0,
      stageWeightLog: 0,

      // ESPN
      lineupDiff: 0,
      gkQualityDiff: 0,
      shotQualityDiff: 0,
      cardImpact: 0,
    };

    // ── Step 3: Single-pass λ prediction ──
    const mlResult = predictUnified(features);

    // ── Step 4: Market fusion (pre-calibration) ──
    let mktWeight = 0;
    const actualHoursToKickoff = Math.max(0, (new Date(match.matchDate).getTime() - Date.now()) / 3600000);
    if (odds) {
      const mktLambda = oddsToMarketLambda(odds.homeOdds, odds.drawOdds, odds.awayOdds, mlResult.homeLambda, mlResult.awayLambda);
      const fused = fuseLambdas(mlResult.homeLambda, mlResult.awayLambda, mktLambda, actualHoursToKickoff, 0);
      mktWeight = fused.marketWeight;
      // Apply fusion result
      const finalHome = fused.homeLambda;
      const finalAway = fused.awayLambda;

      // ── Step 5: Residual correction ──
      const correction = applyResidualCorrection();
      const residualAdj = correction !== '样本不足' ? 1.0 : 0;

      // ── Step 6: Poisson simulation ──
      const seed = matchId.split('').reduce((acc, c) => acc * 31 + c.charCodeAt(0), 0) & 0x7fffffff;
      const dist = runPoissonSimulation(finalHome, finalAway, features.eloDiff, 0.10, 0, seed);

      // ── Step 7: Calibration (H/D/A per-outcome, no market re-blend) ──
      const calibrated = calibrateDistribution(dist, null, 0);

      // ── Step 8: Build report ──
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
        topScores: calibrated.topScores.map((s: any) => ({ score: s.score, prob: s.prob.toString() })),
        over25Prob: calibrated.over25Prob,
        under25Prob: calibrated.under25Prob,
        spread: { line: Math.round((dist.lambdas.homeLambda - dist.lambdas.awayLambda) * 0.6 * 4) / 4, coverProb: 0.5 },
        confidence: calibrated.confidence,
        clusters: calibrated.clusters,
        xgTotal: dist.xgTotal,
        lambdaCI: { home: mlResult.homeCI, away: mlResult.awayCI },
        marketWeight: mktWeight,
      };

      // ── Step 9: Narrative ──
      let narrative = '';
      try {
        narrative = await generateAINarrative({
          homeName: match.homeTeam.name, awayName: match.awayTeam.name,
          homeLambda: dist.lambdas.homeLambda, awayLambda: dist.lambdas.awayLambda,
          homeProb: calibrated.homeWin * 100, drawProb: calibrated.draw * 100, awayProb: calibrated.awayWin * 100,
          topScores: calibrated.topScores.map((s: any) => ({ score: s.score, prob: s.prob.toString() })),
        });
      } catch {}

      // ── Step 10: Persist ──
      const eloDiff = homeElo - awayElo;
      const snapshotId = `fs_${matchId}_${Date.now()}`;
      await prisma.featureSnapshot.create({
        data: {
          id: snapshotId, matchId: match.id,
          eloDiff, xgDiff: homeXG - awayXG, xgaDiff: homeXGA - awayXGA,
          formDiff: homeForm - awayForm, injuryDiff: homePenalty - awayPenalty,
          oddsDelta: 0,
          homeLambda: dist.lambdas.homeLambda, awayLambda: dist.lambdas.awayLambda,
          homeElo, awayElo, homeXG, awayXG, homeXGA, awayXGA, homeForm, awayForm,
          featureVersion: 'v4_unified', modelVersion: VERSIONS.model,
        },
      });

      const predictionId = `ph_${matchId}_${Date.now()}`;
      await prisma.predictionHistory.create({
        data: {
          id: predictionId, matchId: match.id, teamId: match.homeTeamId,
          predHomeWin: calibrated.homeWin, predDraw: calibrated.draw, predAwayWin: calibrated.awayWin,
          featureVersion: 'v4_unified', modelVersion: VERSIONS.model,
          simulationVersion: 'v4_poisson_unified',
        },
      });

      // Record for residual learning
      if (match.status === 'completed' && match.homeScore != null) {
        const outcome = match.homeScore > match.awayScore! ? 'H' : match.homeScore < match.awayScore! ? 'A' : 'D';
        recordPrediction(calibrated.homeWin, calibrated.draw, calibrated.awayWin, outcome);
      }

      // ── Step 11: Response ──
      res.json({
        matchId: match.id, report,
        paths: buildPaths(report),
        radar: buildRadar(match, homeStats, awayStats, homePenalty, awayPenalty),
        narrative,
        simMeta: {
          engine: 'Poisson Matrix 8×8 (Unified V4)',
          correction: 'Dixon-Coles + Residual Learning',
          calibration: 'Per-outcome Platt + Isotonic',
          lambdaVersion: 'V4: Unified Log-Linear (single-pass, no double fitting)',
          baseLambda: { home: mlResult.homeLambda, away: mlResult.awayLambda },
          adjustedLambda: { home: finalHome, away: finalAway },
          fusion: odds ? `${(mktWeight * 100).toFixed(0)}% market` : 'pure statistical',
          residual: correction,
        },
      });
    } else {
      // No odds → pure statistical
      const seed = matchId.split('').reduce((acc, c) => acc * 31 + c.charCodeAt(0), 0) & 0x7fffffff;
      const dist = runPoissonSimulation(mlResult.homeLambda, mlResult.awayLambda, features.eloDiff, 0.10, 0, seed);
      const calibrated = calibrateDistribution(dist, null, 0);

      res.json({
        matchId: match.id,
        report: {
          lambdas: dist.lambdas,
          probabilities: { homeWin: calibrated.homeWin, draw: calibrated.draw, awayWin: calibrated.awayWin,
            rawHomeWin: calibrated.rawHomeWin, rawDraw: calibrated.rawDraw, rawAwayWin: calibrated.rawAwayWin },
          topScores: calibrated.topScores.map((s: any) => ({ score: s.score, prob: s.prob.toString() })),
          over25Prob: calibrated.over25Prob, under25Prob: calibrated.under25Prob,
          spread: { line: 0, coverProb: 0.5 },
          confidence: calibrated.confidence, clusters: calibrated.clusters,
          lambdaCI: { home: mlResult.homeCI, away: mlResult.awayCI }, marketWeight: 0,
        },
        paths: buildPaths({ probabilities: calibrated, clusters: calibrated.clusters }),
        simMeta: { engine: 'Poisson Matrix', lambdaVersion: 'V4 pure statistical', fusion: 'no odds' },
      });
    }
  } catch (error: any) {
    console.error('[PREDICT]', error.message);
    res.status(500).json({ error: 'Prediction engine error', detail: error.message });
  }
});

// ─── Helpers ───

function buildPaths(report: any) {
  const c = report.clusters || {};
  const hProb = report.probabilities?.homeWin ?? 0;
  const aProb = report.probabilities?.awayWin ?? 0;
  return {
    main: { fullScore: aProb > hProb ? `客队胜` : `主队胜`, fullProb: parseFloat((aProb > hProb ? c.narrowAway + c.bigAway : c.narrowHome + c.bigHome || 0).toFixed(3)) },
    backup: { fullScore: `平局`, fullProb: parseFloat((c.draw || 0).toFixed(3)) },
    variable: { fullScore: aProb > hProb ? `主队胜` : `客队胜`, fullProb: parseFloat((aProb > hProb ? c.narrowHome + c.bigHome : c.narrowAway + c.bigAway || 0).toFixed(3)) },
    source: 'Unified V4',
  };
}

function buildRadar(match: any, homeStats: any, awayStats: any, homeInjury: number, awayInjury: number) {
  const h = match.homeTeam, a = match.awayTeam;
  const clamp = (v: number, min: number, max: number) => Math.min(100, Math.max(0, Math.round(((v - min) / (max - min)) * 100)));
  const hs = homeStats || {}, as = awayStats || {};
  return {
    home: [
      clamp(hs.expectedGoalsFor ?? 1.3, 0, 3.0),
      clamp(3.0 - (hs.expectedGoalsAgst ?? 1.2), 0, 3.0),
      clamp(h.eloRating, 1500, 2200),
      clamp(hs.formScore ?? 0.5, 0, 2.0),
      clamp((h.eloRating - 1500) / 700 * 0.6 + (hs.formScore ?? 0.5) * 0.4, 0, 1.0),
      clamp(1.0 - homeInjury, 0.7, 1.0),
    ],
    away: [
      clamp(as.expectedGoalsFor ?? 1.3, 0, 3.0),
      clamp(3.0 - (as.expectedGoalsAgst ?? 1.2), 0, 3.0),
      clamp(a.eloRating, 1500, 2200),
      clamp(as.formScore ?? 0.5, 0, 2.0),
      clamp((a.eloRating - 1500) / 700 * 0.6 + (as.formScore ?? 0.5) * 0.4, 0, 1.0),
      clamp(1.0 - awayInjury, 0.7, 1.0),
    ],
    homeName: h.shortName || h.name, awayName: a.shortName || a.name,
  };
}

export default router;
