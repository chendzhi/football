/**
 * Calibration — Platt Scaling (工业标准)
 *
 * 核心任务：把 "模型概率" 变成 "现实概率"
 *
 * 方法：Logistic Regression 拟合 predicted → actual
 *   z = slope × p + intercept
 *   calibrated = sigmoid(z)
 *
 * 用途：
 *   训练阶段 — fit(samples) 学习 slope 和 intercept
 *   推理阶段 — calibrate(p) 修正原始概率
 */

import { Sample, ReliabilityBin, buildReliability, computeECE } from './reliability';
import { averageBrier } from './brierScore';
import { IsotonicRegression, PerScoreCalibrator } from './isotonic';
import { PrismaClient } from '@prisma/client';

// ─── Platt Scaling ───

export type MatchResult = {
  predictedProb: number;  // 模型原始输出
  actual: number;         // 实际结果 1/0
};

export class Calibration {
  slope: number = 1;
  intercept: number = 0;
  private trained: boolean = false;

  /**
   * Platt Scaling: fit sigmoid(predicted) → actual
   * Uses Gradient Descent on logistic loss.
   */
  fit(samples: MatchResult[], lr: number = 0.01, epochs: number = 200): void {
    if (samples.length < 5) {
      console.warn('[Calibration] Need ≥5 samples, using identity (slope=1, intercept=0)');
      this.slope = 1;
      this.intercept = 0;
      this.trained = false;
      return;
    }

    for (let epoch = 0; epoch < epochs; epoch++) {
      let gradSlope = 0;
      let gradIntercept = 0;

      for (const s of samples) {
        const z = this.slope * s.predictedProb + this.intercept;
        const prob = 1 / (1 + Math.exp(-z));  // sigmoid
        const error = prob - s.actual;

        gradSlope += error * s.predictedProb;
        gradIntercept += error;
      }

      const N = samples.length;
      this.slope -= (lr / N) * gradSlope;
      this.intercept -= (lr / N) * gradIntercept;
    }

    // Clamp to reasonable range
    this.slope = Math.max(0.1, Math.min(5, this.slope));
    this.intercept = Math.max(-3, Math.min(3, this.intercept));
    this.trained = true;
  }

  /** Apply calibration to a raw probability */
  calibrate(p: number): number {
    if (!this.trained) return p;  // identity
    const z = this.slope * p + this.intercept;
    return 1 / (1 + Math.exp(-z));
  }
}

// ─── Global singletons (Platt + Isotonic) ───
let activeCalibrator = new Calibration();
let activeIsotonic = new IsotonicRegression();
let perScoreCalibrator = new PerScoreCalibrator();

export function getCalibrator(): Calibration { return activeCalibrator; }
export function setCalibrator(c: Calibration) { activeCalibrator = c; }

export function getIsotonic(): IsotonicRegression { return activeIsotonic; }
export function getPerScoreCalibrator(): PerScoreCalibrator { return perScoreCalibrator; }

// ─── Calibration Report ───

export interface CalibrationReport {
  slope: number;
  intercept: number;
  ece: number;
  brierScore: number;
  reliabilityCurve: ReliabilityBin[];
  samplesUsed: number;
}

/**
 * Full calibration pipeline:
 *   1. Load historical prediction data
 *   2. Fit Platt Scaling
 *   3. Evaluate calibration quality
 */
export async function runCalibration(prisma: PrismaClient): Promise<CalibrationReport> {
  // Load completed predictions
  const records = await prisma.predictionHistory.findMany({
    where: { actualOutcome: { not: null } },
    orderBy: { createdAt: 'desc' },
  });

  if (records.length === 0) {
    return {
      slope: 1, intercept: 0, ece: 0, brierScore: 0,
      reliabilityCurve: [], samplesUsed: 0,
    };
  }

  // Build per-outcome samples
  const homeSamples: MatchResult[] = [];
  const allSamples: Sample[] = [];

  for (const r of records) {
    const actual = r.actualOutcome!;
    homeSamples.push({
      predictedProb: r.predHomeWin,
      actual: actual === 'H' ? 1 : 0,
    });
    allSamples.push({
      predicted: r.predHomeWin,
      actual: actual === 'H' ? 1 : 0,
    });
  }

  // Fit Platt Scaling
  const cal = new Calibration();
  cal.fit(homeSamples, 0.01, 200);

  // Fit Isotonic Regression
  const iso = new IsotonicRegression();
  iso.fit(
    homeSamples.map(s => s.predictedProb),
    homeSamples.map(s => s.actual)
  );

  // Per-score calibration (home win + over 2.5)
  perScoreCalibrator = new PerScoreCalibrator();
  perScoreCalibrator.fitScore(
    'homeWin',
    homeSamples.map(s => s.predictedProb),
    homeSamples.map(s => s.actual)
  );

  // Only Platt for < 50 samples (Isotonic overfits on small data)
  setCalibrator(cal);
  if (records.length >= 50) {
    activeIsotonic = iso;
  }
  // With <50 samples: only Platt active, Isotonic = identity
  const calibrated = homeSamples.map(s => ({ pred: cal.calibrate(s.predictedProb), actual: s.actual }));
  const bs = averageBrier(calibrated);
  const ece = computeECE(allSamples);
  const curve = buildReliability(allSamples);

  return {
    slope: parseFloat(cal.slope.toFixed(4)),
    intercept: parseFloat(cal.intercept.toFixed(4)),
    ece,
    brierScore: parseFloat(bs.toFixed(4)),
    reliabilityCurve: curve,
    samplesUsed: records.length,
  };
}
