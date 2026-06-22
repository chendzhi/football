/**
 * 模型评估指标: Brier Score, Ranked Probability Score (RPS), Log Loss
 */

export function brierScore(pred: number, actual: number): number {
  return (pred - actual) ** 2;
}

export function ternaryBrier(predH: number, predD: number, predA: number, outcome: string): number {
  const oH = outcome === 'H' ? 1 : 0;
  const oD = outcome === 'D' ? 1 : 0;
  const oA = outcome === 'A' ? 1 : 0;
  return (predH - oH) ** 2 + (predD - oD) ** 2 + (predA - oA) ** 2;
}

/**
 * RPS (Ranked Probability Score) — 比 Brier 更敏感的排序误差
 * 用于评估概率分布的质量
 */
export function rankedProbabilityScore(
  probs: { homeWin: number; draw: number; awayWin: number },
  outcome: string
): number {
  const cumPred = [
    probs.homeWin,
    probs.homeWin + probs.draw,
    probs.homeWin + probs.draw + probs.awayWin,
  ];
  const cumOut = [
    outcome === 'H' ? 1 : 0,
    outcome === 'H' || outcome === 'D' ? 1 : 0,
    1,
  ];
  let rps = 0;
  for (let i = 0; i < 3; i++) {
    rps += (cumPred[i] - cumOut[i]) ** 2;
  }
  return parseFloat((rps / 2).toFixed(6));
}

/**
 * Log Loss — 校准质量
 */
export function logLoss(prob: number, actual: number): number {
  const eps = 1e-15;
  return -(actual * Math.log(Math.max(prob, eps)) + (1 - actual) * Math.log(Math.max(1 - prob, eps)));
}
