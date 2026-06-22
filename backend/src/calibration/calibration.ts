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

    // Tighter clamp — prevent overfitting on small samples
    this.slope = Math.max(0.3, Math.min(3.0, this.slope));
    this.intercept = Math.max(-1.5, Math.min(1.5, this.intercept));
    this.trained = true;
  }

  /** Apply calibration — constrained within 0.5x~2x raw */
  calibrate(p: number, rawP?: number): number {
    if (!this.trained) return p;
    const z = this.slope * p + this.intercept;
    let calibrated = 1 / (1 + Math.exp(-z));
    if (rawP !== undefined && rawP > 0.05) {
      calibrated = Math.max(rawP * 0.5, Math.min(rawP * 2.0, calibrated));
    }
    return Math.max(0.05, Math.min(0.90, calibrated));
  }
}

// ─── Global singletons (Platt + Isotonic) ───
let activeCalibrator = new Calibration();
let activeIsotonic = new IsotonicRegression();
let perScoreCalibrator = new PerScoreCalibrator();

// Per-outcome calibrators (H/D/A independent)
let outcomeCalibrators: { H: Calibration; D: Calibration; A: Calibration } | null = null;
let outcomeIsotonics: { H: IsotonicRegression; D: IsotonicRegression; A: IsotonicRegression } | null = null;

export function getCalibrator(): Calibration { return activeCalibrator; }
export function setCalibrator(c: Calibration) { activeCalibrator = c; }

export function getIsotonic(): IsotonicRegression { return activeIsotonic; }
export function getPerScoreCalibrator(): PerScoreCalibrator { return perScoreCalibrator; }

export function getOutcomeCalibrators() { return outcomeCalibrators; }
export function getOutcomeIsotonics() { return outcomeIsotonics; }

// ─── Calibration Report ───

export interface CalibrationReport {
  slope: number;
  intercept: number;
  ece: number;
  brierScore: number;
  reliabilityCurve: ReliabilityBin[];
  samplesUsed: number;
  outcomeSlopes: { H: number; D: number; A: number };
  outcomeIntercepts: { H: number; D: number; A: number };
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
      outcomeSlopes: { H: 1, D: 1, A: 1 },
      outcomeIntercepts: { H: 0, D: 0, A: 0 },
    };
  }

  // Build per-outcome samples (H/D/A independent)
  const homeSamples: MatchResult[] = [];
  const drawSamples: MatchResult[] = [];
  const awaySamples: MatchResult[] = [];
  const allSamples: Sample[] = [];

  for (const r of records) {
    const actual = r.actualOutcome!;
    homeSamples.push({ predictedProb: r.predHomeWin, actual: actual === 'H' ? 1 : 0 });
    drawSamples.push({ predictedProb: r.predDraw,    actual: actual === 'D' ? 1 : 0 });
    awaySamples.push({ predictedProb: r.predAwayWin, actual: actual === 'A' ? 1 : 0 });
    allSamples.push({ predicted: r.predHomeWin, actual: actual === 'H' ? 1 : 0 });
  }

  // Fit THREE separate Platt calibrators (H/D/A)
  const calH = new Calibration(); calH.fit(homeSamples, 0.01, 200);
  const calD = new Calibration(); calD.fit(drawSamples, 0.01, 200);
  const calA = new Calibration(); calA.fit(awaySamples, 0.01, 200);

  // Fit THREE separate Isotonic regressions
  const isoH = new IsotonicRegression(); const isoD = new IsotonicRegression(); const isoA = new IsotonicRegression();
  isoH.fit(homeSamples.map(s => s.predictedProb), homeSamples.map(s => s.actual));
  isoD.fit(drawSamples.map(s => s.predictedProb), drawSamples.map(s => s.actual));
  isoA.fit(awaySamples.map(s => s.predictedProb), awaySamples.map(s => s.actual));

  // Store per-outcome calibrators
  outcomeCalibrators = { H: calH, D: calD, A: calA };
  if (records.length >= 50) {
    outcomeIsotonics = { H: isoH, D: isoD, A: isoA };
  }

  // Per-score calibration (home win + over 2.5)
  perScoreCalibrator = new PerScoreCalibrator();
  perScoreCalibrator.fitScore(
    'homeWin',
    homeSamples.map(s => s.predictedProb),
    homeSamples.map(s => s.actual)
  );

  // Legacy: keep single calibrator for backward compat
  setCalibrator(calH);
  if (records.length >= 50) {
    activeIsotonic = isoH;
  }
  const calibrated = homeSamples.map(s => ({ pred: calH.calibrate(s.predictedProb), actual: s.actual }));
  const bs = averageBrier(calibrated);
  const ece = computeECE(allSamples);
  const curve = buildReliability(allSamples);

  return {
    slope: parseFloat(calH.slope.toFixed(4)),
    intercept: parseFloat(calH.intercept.toFixed(4)),
    ece,
    brierScore: parseFloat(bs.toFixed(4)),
    reliabilityCurve: curve,
    samplesUsed: records.length,
    outcomeSlopes: {
      H: parseFloat(calH.slope.toFixed(4)),
      D: parseFloat(calD.slope.toFixed(4)),
      A: parseFloat(calA.slope.toFixed(4)),
    },
    outcomeIntercepts: {
      H: parseFloat(calH.intercept.toFixed(4)),
      D: parseFloat(calD.intercept.toFixed(4)),
      A: parseFloat(calA.intercept.toFixed(4)),
    },
  };
}
