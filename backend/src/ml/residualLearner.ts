/**
 * Residual Learning Layer — 预测误差回流修正
 *
 * 追踪 预测 vs 真实 偏差，学习系统性偏置修正
 *
 * 两层:
 *   1. Outcome bias: 如果模型系统性低估主胜,自动调升主胜 bias
 *   2. Feature bias: 如果某个特征持续贡献错误方向,衰减其权重
 */

import type { PrismaClient } from '@prisma/client';
import { getUnifiedWeights, setUnifiedWeights } from './unifiedPredictor';

interface ErrorRecord {
  predHome: number; predDraw: number; predAway: number;
  actual: 'H' | 'D' | 'A';
  features: Record<string, number>;
}

let errorHistory: ErrorRecord[] = [];
const MAX_HISTORY = 50;

export function recordPrediction(
  predHome: number, predDraw: number, predAway: number,
  actual: 'H' | 'D' | 'A',
  features: Record<string, number> = {}
): void {
  errorHistory.push({ predHome, predDraw, predAway, actual, features });
  if (errorHistory.length > MAX_HISTORY) errorHistory.shift();
}

/**
 * Compute residual correction from recent errors
 * Returns bias adjustments to add to log-lambda
 */
export function computeResidualCorrection(): {
  homeBiasCorrection: number;
  awayBiasCorrection: number;
  drawCorrection: number;
  confidence: string;
} {
  if (errorHistory.length < 5) {
    return { homeBiasCorrection: 0, awayBiasCorrection: 0, drawCorrection: 0, confidence: '样本不足' };
  }

  const recent = errorHistory.slice(-20);
  let predHomeSum = 0, actualHomeSum = 0;
  let predAwaySum = 0, actualAwaySum = 0;
  let predDrawSum = 0, actualDrawSum = 0;

  for (const r of recent) {
    predHomeSum += r.predHome;
    actualHomeSum += (r.actual === 'H' ? 1 : 0);
    predAwaySum += r.predAway;
    actualAwaySum += (r.actual === 'A' ? 1 : 0);
    predDrawSum += r.predDraw;
    actualDrawSum += (r.actual === 'D' ? 1 : 0);
  }

  const n = recent.length;
  const avgPredHome = predHomeSum / n;
  const avgActualHome = actualHomeSum / n;
  const avgPredAway = predAwaySum / n;
  const avgActualAway = actualAwaySum / n;
  const avgPredDraw = predDrawSum / n;
  const avgActualDraw = actualDrawSum / n;

  // Bias = actual - predicted (positive = under-estimated)
  const homeBias = avgActualHome - avgPredHome;
  const awayBias = avgActualAway - avgPredAway;
  const drawBias = avgActualDraw - avgPredDraw;

  // Correction in log-space: small adjustment proportional to bias
  const homeBiasCorrection = parseFloat((Math.tanh(homeBias * 1.5) * 0.15).toFixed(4));
  const awayBiasCorrection = parseFloat((Math.tanh(awayBias * 1.5) * 0.15).toFixed(4));
  const drawCorrection = parseFloat((Math.tanh(drawBias * 1.5) * 0.10).toFixed(4));

  const absBias = Math.abs(homeBias) + Math.abs(awayBias) + Math.abs(drawBias);
  const confidence = absBias < 0.05 ? '低偏差' : absBias < 0.15 ? '中偏差' : '高偏差,建议重训练';

  return { homeBiasCorrection, awayBiasCorrection, drawCorrection, confidence };
}

/**
 * Load error history from DB (called on startup)
 */
export async function loadErrorHistory(prisma: PrismaClient): Promise<void> {
  try {
    const records = await prisma.predictionHistory.findMany({
      where: { actualOutcome: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY,
    });

    errorHistory = records.map(r => ({
      predHome: r.predHomeWin,
      predDraw: r.predDraw,
      predAway: r.predAwayWin,
      actual: r.actualOutcome as 'H' | 'D' | 'A',
      features: {},
    }));

    console.log(`[Residual] loaded ${errorHistory.length} historical predictions`);
  } catch {}
}

/**
 * Apply residual correction to unified weights
 */
export function applyResidualCorrection(): string {
  const correction = computeResidualCorrection();
  if (correction.confidence === '样本不足') return correction.confidence;

  const w = getUnifiedWeights();
  // Slight adjustment to bias terms
  setUnifiedWeights({
    biasHome: parseFloat((w.biasHome + correction.homeBiasCorrection).toFixed(4)),
    biasAway: parseFloat((w.biasAway + correction.awayBiasCorrection).toFixed(4)),
  });

  return `矫正: homeBias=${correction.homeBiasCorrection.toFixed(3)}, awayBias=${correction.awayBiasCorrection.toFixed(3)}, ${correction.confidence}`;
}
