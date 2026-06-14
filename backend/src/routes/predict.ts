import { Router } from 'express';
import prisma from '../db';
import { runMonteCarloSimulation } from '../simulation';
import { computeInjuryPenalty } from '../feature';
import { RawTeamFeatures, RawOddsFeatures } from '../types';
import { VERSIONS } from '../version';

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

    const report = runMonteCarloSimulation(homeFeatures, awayFeatures, odds);

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
      snapshotId,
      predictionId
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal predictive engine error' });
  }
});

export default router;
