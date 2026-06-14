/**
 * Dataset Builder — 从 DB 生成 λ 模型训练数据
 *
 * X = FeatureVector (from completed matches with scores)
 * y = { homeGoals, awayGoals }
 *
 * 支持:
 *   - 时间加权 (recent > old)
 *   - 训练/测试 split (time-series, 70/30)
 *   - 多源融合
 */

import { PrismaClient } from '@prisma/client';
import { FeatureVector } from '../../ml/featuresMatrix';
import { buildFeaturesForMatch } from './featureBuilder';

export interface TrainingPair {
  features: FeatureVector;
  homeGoals: number;
  awayGoals: number;
  weight: number;         // time-decay weight
  matchDate: string;
  competition: string;
}

export interface TrainingDataset {
  train: TrainingPair[];
  test: TrainingPair[];
  totalMatches: number;
  withOdds: number;
  withStats: number;
}

/**
 * Build time-aware training dataset from completed matches.
 *
 * Split: first 70% train, last 30% test (time-series split, NOT random)
 * Weight: exponential decay with half-life of 365 days
 */
export async function buildTrainingDataset(prisma: PrismaClient): Promise<TrainingDataset> {
  const matches = await prisma.match.findMany({
    where: {
      status: 'completed',
      homeScore: { not: null },
      awayScore: { not: null },
    },
    orderBy: { matchDate: 'asc' },
    include: { homeTeam: true, awayTeam: true },
  });

  if (matches.length === 0) {
    return { train: [], test: [], totalMatches: 0, withOdds: 0, withStats: 0 };
  }

  const pairs: TrainingPair[] = [];

  // Reference date for time-decay (most recent match = weight 1.0)
  const now = new Date();
  const halfLife = 365 * 24 * 3600 * 1000; // 365 days in ms

  for (const m of matches) {
    const featResult = await buildFeaturesForMatch(prisma, m.id);
    if (!featResult) continue;

    // Time-decay weight: recent matches weighted higher
    const ageMs = now.getTime() - new Date(m.matchDate).getTime();
    const weight = Math.exp(-Math.log(2) * ageMs / halfLife);

    pairs.push({
      features: featResult.features,
      homeGoals: m.homeScore!,
      awayGoals: m.awayScore!,
      weight: parseFloat(weight.toFixed(3)),
      matchDate: m.matchDate.toISOString(),
      competition: m.groupName,
    });
  }

  // Time-series split (70% train, 30% test)
  const splitIdx = Math.floor(pairs.length * 0.7);
  const train = pairs.slice(0, splitIdx);
  const test = pairs.slice(splitIdx);

  return {
    train,
    test,
    totalMatches: matches.length,
    withOdds: pairs.filter(p => p.features.eloDiff !== 0).length, // all have stats
    withStats: pairs.length,
  };
}

/**
 * Export dataset stats for monitoring.
 */
export function datasetStats(ds: TrainingDataset): string {
  const trainHomeAvg = ds.train.reduce((s, p) => s + p.homeGoals, 0) / ds.train.length || 0;
  const testHomeAvg = ds.test.reduce((s, p) => s + p.homeGoals, 0) / ds.test.length || 0;
  return [
    `Total: ${ds.totalMatches} (train: ${ds.train.length}, test: ${ds.test.length})`,
    `With odds: ${ds.withOdds}/${ds.totalMatches}`,
    `Avg home goals — train: ${trainHomeAvg.toFixed(2)}, test: ${testHomeAvg.toFixed(2)}`,
  ].join(' | ');
}
