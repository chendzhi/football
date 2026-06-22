/**
 * ML Model Trainer — 从数据库训练 λ 模型
 *
 * Prisma 依赖仅在此文件，不在 lambdaPredictor 中。
 * 由 auto-sync 在后台调用。
 */

import type { PrismaClient } from '@prisma/client';
import { buildTrainingDataset } from './datasetBuilder';
import { train } from './trainLambdaModel';
import { updateTrainedWeights } from './lambdaPredictor';

export async function trainModel(prisma: PrismaClient): Promise<{
  samplesUsed: number;
  finalLoss: number;
}> {
  const samples = await buildTrainingDataset(prisma);
  if (samples.length < 3) {
    console.log('[ML] too few samples (' + samples.length + '), using default weights');
    return { samplesUsed: samples.length, finalLoss: 0 };
  }

  const result = train(samples);
  updateTrainedWeights(result.weights, samples.length);

  console.log('[ML] trained on ' + samples.length + ' matches · loss=' + result.finalLoss);
  return { samplesUsed: samples.length, finalLoss: result.finalLoss };
}
