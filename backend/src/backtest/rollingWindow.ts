/**
 * Rolling Window — 看模型是否在退化还是改善
 *
 * 滑动窗口计算 Brier/Accuracy 的趋势
 */

import { PredictionRecord } from './backtestEngine';

export interface RollingWindowResult {
  window: number;
  startIdx: number;
  endIdx: number;
  brier: number;
  accuracy: number;
  count: number;
}

/**
 * Compute rolling metrics over a sliding window.
 * @param records — sorted by time (oldest first)
 * @param windowSize — number of predictions per window
 */
export function computeRollingMetrics(
  records: PredictionRecord[],
  windowSize: number = 5
): RollingWindowResult[] {
  if (records.length < windowSize) return [];

  const results: RollingWindowResult[] = [];

  for (let i = 0; i <= records.length - windowSize; i++) {
    const window = records.slice(i, i + windowSize);
    const N = window.length;

    let brierSum = 0;
    let correct = 0;

    for (const r of window) {
      brierSum += r.brierScore;
      const pred =
        r.predictedHomeWin > r.predictedDraw && r.predictedHomeWin > r.predictedAwayWin
          ? 'H' : r.predictedDraw > r.predictedAwayWin ? 'D' : 'A';
      const actual = r.actualResult === 'HOME' ? 'H' : r.actualResult === 'DRAW' ? 'D' : 'A';
      if (pred === actual) correct++;
    }

    results.push({
      window: i + 1,
      startIdx: i,
      endIdx: i + windowSize - 1,
      brier: parseFloat((brierSum / N).toFixed(4)),
      accuracy: parseFloat((correct / N).toFixed(4)),
      count: N,
    });
  }

  return results;
}

/** Detect if model is improving (Brier decreasing) or degrading */
export function trendDirection(rolling: RollingWindowResult[]): 'improving' | 'degrading' | 'stable' {
  if (rolling.length < 2) return 'stable';
  const first = rolling.slice(0, 3).reduce((s, r) => s + r.brier, 0) / 3;
  const last = rolling.slice(-3).reduce((s, r) => s + r.brier, 0) / 3;
  const diff = first - last;
  if (diff > 0.05) return 'improving';
  if (diff < -0.05) return 'degrading';
  return 'stable';
}
