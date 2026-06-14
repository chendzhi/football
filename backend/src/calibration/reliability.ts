/**
 * Reliability Curve — 校准曲线的核心
 *
 * 检查：预测 70% → 是否真的发生 70%？
 *
 * 完美的校准曲线应该是 y = x（对角线）
 */

import { getBin, ALL_BINS } from './probabilityBins';

export type Sample = {
  predicted: number;  // 模型输出概率
  actual: number;     // 实际结果 (0 或 1)
};

export interface ReliabilityBin {
  bin: string;
  avgPred: number;
  avgActual: number;
  count: number;
  gap: number;  // calibration gap = pred - actual
}

/**
 * Build reliability curve from prediction samples.
 * Returns one data point per probability bin.
 */
export function buildReliability(samples: Sample[]): ReliabilityBin[] {
  const bins: Record<string, { sum: number; count: number; actual: number }> = {};

  for (const s of samples) {
    const bin = getBin(s.predicted);
    if (!bins[bin]) {
      bins[bin] = { sum: 0, count: 0, actual: 0 };
    }
    bins[bin].sum += s.predicted;
    bins[bin].actual += s.actual;
    bins[bin].count += 1;
  }

  return ALL_BINS.map(bin => {
    const v = bins[bin];
    if (!v || v.count === 0) return null;
    return {
      bin,
      avgPred: parseFloat((v.sum / v.count).toFixed(4)),
      avgActual: parseFloat((v.actual / v.count).toFixed(4)),
      count: v.count,
      gap: parseFloat(((v.sum / v.count) - (v.actual / v.count)).toFixed(4)),
    };
  }).filter(Boolean) as ReliabilityBin[];
}

/**
 * Expected Calibration Error (ECE)
 * Weighted average of |avgPred - avgActual| across bins.
 */
export function computeECE(samples: Sample[]): number {
  const curve = buildReliability(samples);
  if (curve.length === 0) return 0;

  let ece = 0;
  const totalCount = curve.reduce((s, b) => s + b.count, 0);
  for (const bin of curve) {
    const weight = bin.count / totalCount;
    ece += weight * Math.abs(bin.gap);
  }
  return parseFloat(ece.toFixed(4));
}
