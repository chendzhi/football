/**
 * Lambda Model v2 — Poisson Log-Linear
 *
 * λ = exp(w · x)    (not λ = w · x)
 *
 * This guarantees λ > 0 without clamping, matches the
 * Poisson process's exponential-family nature, and produces
 * more realistic goal distributions.
 */

import { FeatureVector } from './featuresMatrix';

export interface LambdaModelWeights {
  elo: number;
  xg: number;
  xga: number;
  form: number;
  injury: number;
  home: number;
  odds: number;
  biasHome: number;   // log-space intercept
  biasAway: number;
}

/**
 * Calibrated to produce λ_home ≈ 1.3-2.5 for typical international matchups.
 * Weights are in log-space: exp(biasHome + w*features)
 */
export const DEFAULT_WEIGHTS: LambdaModelWeights = {
  elo: 0.0008,       // ~0.0015 in linear space → halved for log-scale stability
  xg: 0.18,
  xga: -0.10,
  form: 0.08,
  injury: -0.20,
  home: 0.04,
  odds: 0.02,
  biasHome: 0.35,    // exp(0.35) ≈ 1.42 (base home λ)
  biasAway: 0.30,    // exp(0.30) ≈ 1.35 (base away λ)
};

export class LambdaModel {
  constructor(public w: LambdaModelWeights) {}

  /**
   * Predict λ_home and λ_away.
   *
   * λ_home = exp(biasHome + Σ w_i · feat_i)
   * λ_away = exp(biasAway + Σ w_i · (-feat_i))
   *
   * The exponential ensures λ > 0 and matches Poisson assumptions.
   */
  predict(features: FeatureVector): { homeLambda: number; awayLambda: number } {
    const { eloDiff, xGDiff, xGADiff, formDiff, injuryDiff, homeAdvantage } = features;

    // Pure statistical λ — no market features
    const homeLog =
      this.w.biasHome +
      this.w.elo * eloDiff +
      this.w.xg * xGDiff +
      this.w.xga * xGADiff +
      this.w.form * formDiff +
      this.w.injury * injuryDiff +
      this.w.home * homeAdvantage;

    const awayLog =
      this.w.biasAway +
      this.w.elo * (-eloDiff) +
      this.w.xg * (-xGDiff) +
      this.w.xga * (-xGADiff) +
      this.w.form * (-formDiff) +
      this.w.injury * (-injuryDiff);

    return {
      homeLambda: parseFloat(Math.exp(homeLog).toFixed(4)),
      awayLambda: parseFloat(Math.exp(awayLog).toFixed(4)),
    };
  }

  /** Enforce market weight ≤ 10% of total weight magnitude */
  clampMarketWeight(): void {
    const totalMarket = Math.abs(this.w.odds);
    const totalCore =
      Math.abs(this.w.elo) + Math.abs(this.w.xg) + Math.abs(this.w.xga) +
      Math.abs(this.w.form) + Math.abs(this.w.injury) + Math.abs(this.w.home) +
      Math.abs(this.w.biasHome) + Math.abs(this.w.biasAway);

    const ratio = totalMarket / (totalCore + totalMarket);
    if (ratio > 0.10) {
      this.w.odds *= (0.10 * totalCore) / (0.90 * totalMarket);
    }
  }
}
