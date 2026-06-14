/**
 * Dixon-Coles v2 — Strengthened Low-Score Correction
 *
 * rho = 0.12 (stronger than v1's 0.10)
 * Weight multipliers per scoreline:
 *   0-0: 1 + τ
 *   1-0: 1 + 0.8τ
 *   0-1: 1 + 0.8τ
 *   1-1: 1 + 0.6τ
 */

// Football has ρ ≈ -0.05 to -0.15 (negative = low scores positively correlated)
// With ρ < 0: τ(0,0)>1, τ(1,1)>1 → low-score draws more likely
export function dixonColesTau(x: number, y: number, lambda: number, mu: number, rho = -0.12): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;   // >1 when ρ<0
  if (x === 0 && y === 1) return 1 + lambda * rho;        // <1 when ρ<0
  if (x === 1 && y === 0) return 1 + mu * rho;            // <1 when ρ<0
  if (x === 1 && y === 1) return 1 - rho;                 // >1 when ρ<0
  return 1.0;
}

export function dixonColesMaxTau(lambda: number, mu: number, rho = -0.12): number {
  return Math.max(1 - lambda * mu * rho, 1 + lambda * rho, 1 + mu * rho, 1 - rho, 1.0);
}

/**
 * Post-simulation low-score weight adjustment.
 * Applied to score frequency counts after Monte Carlo.
 */
export function lowScoreWeight(score: string, lambda: number, mu: number): number {
  const rho = 0.12;
  const tau = Math.exp(-lambda - mu);
  switch (score) {
    case '0-0': return 1 + tau;
    case '1-0': case '0-1': return 1 + tau * 0.8;
    case '1-1': return 1 + tau * 0.6;
    default: return 1.0;
  }
}
