/**
 * Brier Score — 概率预测误差的黄金标准
 *
 * BS = (1/N) * Σ(pred - actual)²
 * 0 = 完美, 0.667 = 瞎猜(33/33/33), 1.0 = 完全错误
 */

export function brierScore(pred: number, actual: number): number {
  return (pred - actual) ** 2;
}

/** 三元 Brier Score (胜/平/负) */
export function ternaryBrier(
  predHome: number, predDraw: number, predAway: number,
  outcome: 'H' | 'D' | 'A'
): number {
  const oH = outcome === 'H' ? 1 : 0;
  const oD = outcome === 'D' ? 1 : 0;
  const oA = outcome === 'A' ? 1 : 0;
  return (predHome - oH) ** 2 + (predDraw - oD) ** 2 + (predAway - oA) ** 2;
}

/** Average Brier Score over N predictions */
export function averageBrier(
  predictions: Array<{ pred: number; actual: number }>
): number {
  if (predictions.length === 0) return 0;
  const sum = predictions.reduce((s, p) => s + brierScore(p.pred, p.actual), 0);
  return sum / predictions.length;
}
