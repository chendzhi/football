/**
 * Dataset Builder — Extract training samples from match history
 *
 * Data source: PredictionHistory + Match + TeamStats + actual scores
 */

import { PrismaClient } from '@prisma/client';
import { FeatureVector, buildFeatureVector } from './featuresMatrix';

export interface TrainingSample {
  features: FeatureVector;
  labelHomeGoals: number;
  labelAwayGoals: number;
}

/**
 * Build training dataset from completed matches with known scores.
 * Uses TeamStats for xG/xGA/form data.
 */
export async function buildTrainingDataset(prisma: PrismaClient): Promise<TrainingSample[]> {
  const completed = await prisma.match.findMany({
    where: { status: 'completed', homeScore: { not: null }, awayScore: { not: null } },
    include: {
      homeTeam: true,
      awayTeam: true,
      predictions: { where: { actualOutcome: { not: null } } },
    },
  });

  const samples: TrainingSample[] = [];

  for (const match of completed) {
    const homeStats = await prisma.teamStats.findFirst({ where: { teamId: match.homeTeamId } });
    const awayStats = await prisma.teamStats.findFirst({ where: { teamId: match.awayTeamId } });

    const features = buildFeatureVector({
      homeElo: match.homeTeam.eloRating,
      awayElo: match.awayTeam.eloRating,
      homeXG: homeStats?.expectedGoalsFor ?? 1.3,
      awayXG: awayStats?.expectedGoalsFor ?? 1.3,
      homeXGA: homeStats?.expectedGoalsAgst ?? 1.2,
      awayXGA: awayStats?.expectedGoalsAgst ?? 1.2,
      homeForm: homeStats?.formScore ?? 0.5,
      awayForm: awayStats?.formScore ?? 0.5,
      homeInjury: 0,
      awayInjury: 0,
    });

    samples.push({
      features,
      labelHomeGoals: match.homeScore!,
      labelAwayGoals: match.awayScore!,
    });
  }

  return samples;
}
