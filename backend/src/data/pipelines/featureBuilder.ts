/**
 * Feature Builder — 从标准化数据构建 FeatureVector
 *
 * 输入: StandardMatch + TeamStats + OddsSnapshot[]
 * 输出: FeatureVector (10 维)
 */

import { PrismaClient } from '@prisma/client';
import { FeatureVector, buildFeatureVector } from '../../ml/featuresMatrix';

export interface FeatureBuildResult {
  matchId: string;
  features: FeatureVector;
  homeLambda?: number;
  awayLambda?: number;
  source: string;
  hasOdds: boolean;
  hasStats: boolean;
}

/**
 * Build feature vector for a single match from DB data.
 * Uses OddsSnapshot time-series for velocity + pressure.
 */
export async function buildFeaturesForMatch(
  prisma: PrismaClient,
  matchId: string
): Promise<FeatureBuildResult | null> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { homeTeam: true, awayTeam: true },
  });
  if (!match) return null;

  const homeStats = await prisma.teamStats.findFirst({ where: { teamId: match.homeTeamId } });
  const awayStats = await prisma.teamStats.findFirst({ where: { teamId: match.awayTeamId } });
  const odds = await prisma.odds.findFirst({ where: { matchId } });

  // Time-series odds for velocity + MPI
  const snapshots = await prisma.oddsSnapshot.findMany({
    where: { matchId },
    orderBy: { timestamp: 'asc' },
  });

  // Market data reserved for marketAdapter (not used in λ training)
  const hasRealOdds = odds && snapshots.length >= 2;

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

  return {
    matchId,
    features,
    source: snapshots.length > 0 ? 'sporttery' : 'estimated',
    hasOdds: !!odds,
    hasStats: !!(homeStats && awayStats),
  };
}

/**
 * Batch build features for all matches in a date range.
 */
export async function buildAllFeatures(
  prisma: PrismaClient,
  fromDate?: Date,
  toDate?: Date
): Promise<FeatureBuildResult[]> {
  const where: any = {};
  if (fromDate || toDate) {
    where.matchDate = {};
    if (fromDate) where.matchDate.gte = fromDate;
    if (toDate) where.matchDate.lte = toDate;
  }

  const matches = await prisma.match.findMany({
    where,
    orderBy: { matchDate: 'asc' },
  });

  const results: FeatureBuildResult[] = [];
  for (const m of matches) {
    const r = await buildFeaturesForMatch(prisma, m.id);
    if (r) results.push(r);
  }

  return results;
}
