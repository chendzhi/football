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
  // Lightweight query — select only needed fields, no nested includes
  const completed = await prisma.match.findMany({
    where: { status: 'completed', homeScore: { not: null }, awayScore: { not: null }, stage: { not: 'HISTORICAL' } },
    select: {
      homeTeamId: true, awayTeamId: true,
      homeScore: true, awayScore: true,
    },
    take: 500, // Cap to prevent overflow
  });

  const samples: TrainingSample[] = [];

  for (const match of completed) {
    const [homeTeam, awayTeam, homeStats, awayStats] = await Promise.all([
      prisma.team.findUnique({ where: { id: match.homeTeamId }, select: { eloRating: true } }),
      prisma.team.findUnique({ where: { id: match.awayTeamId }, select: { eloRating: true } }),
      prisma.teamStats.findFirst({ where: { teamId: match.homeTeamId } }),
      prisma.teamStats.findFirst({ where: { teamId: match.awayTeamId } }),
    ]);

    const features = buildFeatureVector({
      homeElo: homeTeam?.eloRating ?? 1500,
      awayElo: awayTeam?.eloRating ?? 1500,
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
