/**
 * Isotonic Regression — Pool Adjacent Violators (PAV) Algorithm
 *
 * Better than Platt Scaling for football probability calibration:
 *   - Non-parametric (no assumption of sigmoid shape)
 *   - Monotonicity-preserving
 *   - Handles per-bin nonlinear calibration
 *
 * Usage:
 *   1. fit(predictions, actuals) → learn isotonic function
 *   2. calibrate(p) → map raw prob to calibrated prob
 */

export class IsotonicRegression {
  private thresholds: number[] = [];
  private calibrated: number[] = [];

  /**
   * Fit isotonic regression using PAV algorithm.
   * @param predictions — model raw probabilities (sorted)
   * @param actuals — binary outcomes (0 or 1, same order as predictions)
   */
  fit(predictions: number[], actuals: number[]): void {
    if (predictions.length < 5) {
      // Too few samples — identity mapping
      this.thresholds = [0, 1];
      this.calibrated = [0, 1];
      return;
    }

    // Sort by predicted probability
    const pairs = predictions.map((p, i) => ({ p, a: actuals[i] }));
    pairs.sort((a, b) => a.p - b.p);

    // PAV: merge adjacent bins that violate monotonicity
    let bins: Array<{ sumP: number; sumA: number; count: number }> = pairs.map(p => ({
      sumP: p.p, sumA: p.a, count: 1,
    }));

    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < bins.length - 1; i++) {
        const avgCurr = bins[i].sumA / bins[i].count;
        const avgNext = bins[i + 1].sumA / bins[i + 1].count;
        if (avgCurr > avgNext) {
          // Violation: merge bins
          bins[i].sumP += bins[i + 1].sumP;
          bins[i].sumA += bins[i + 1].sumA;
          bins[i].count += bins[i + 1].count;
          bins.splice(i + 1, 1);
          changed = true;
          break;
        }
      }
    }

    // Build lookup table
    this.thresholds = [0];
    this.calibrated = [bins[0].sumA / bins[0].count];

    for (let i = 0; i < bins.length; i++) {
      const avgP = bins[i].sumP / bins[i].count;
      const avgA = bins[i].sumA / bins[i].count;
      // Use max predicted value in the bin as threshold
      this.thresholds.push(Math.max(avgP, this.thresholds[this.thresholds.length - 1] + 0.001));
      this.calibrated.push(avgA);
    }
  }

  /** Map raw probability to calibrated probability */
  calibrate(p: number): number {
    if (this.thresholds.length < 2) return p;

    // Binary search for the right bin
    let lo = 0, hi = this.thresholds.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (this.thresholds[mid] <= p) lo = mid;
      else hi = mid - 1;
    }

    return Math.max(0, Math.min(1, this.calibrated[Math.min(lo, this.calibrated.length - 1)]));
  }
}

// ─── Per-Score Calibration ───

export interface ScoreCalibration {
  isotonic: IsotonicRegression;
  scoreType: string;  // 'homeWin' | 'over25' | 'exact1-0' etc.
}

export class PerScoreCalibrator {
  private calibrators: Map<string, IsotonicRegression> = new Map();

  fitScore(scoreType: string, predictions: number[], actuals: number[]): void {
    const iso = new IsotonicRegression();
    iso.fit(predictions, actuals);
    this.calibrators.set(scoreType, iso);
  }

  calibrate(scoreType: string, p: number): number {
    const iso = this.calibrators.get(scoreType);
    return iso ? iso.calibrate(p) : p;
  }

  get size(): number { return this.calibrators.size; }
}
