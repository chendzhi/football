/**
 * Lambda Model Trainer v2 — Poisson Log-Linear
 *
 * Loss = Poisson deviance: λ_pred - y_true · log(λ_pred)
 *       where λ_pred = exp(w · x)
 *
 * Gradient: ∂L/∂w = (exp(w·x) - y_true) · x
 *
 * This is the statistically correct loss for count data (goals).
 */

import { TrainingSample } from './datasetBuilder';
import { LambdaModelWeights, DEFAULT_WEIGHTS, LambdaModel } from './lambdaModel';
import { FeatureVector } from './featuresMatrix';

export interface TrainingResult {
  weights: LambdaModelWeights;
  finalLoss: number;
  epochs: number;
  samplesUsed: number;
}

// ─── Feature Standardization ───

interface Scaler {
  mean: Record<string, number>;
  std: Record<string, number>;
}

function fitScaler(samples: TrainingSample[]): Scaler {
  const keys = ['eloDiff','xGDiff','xGADiff','formDiff','injuryDiff','homeAdvantage','oddsDelta'];
  const sums: Record<string,number>={}, sqSums: Record<string,number>={};
  for (const k of keys) { sums[k]=0; sqSums[k]=0; }

  for (const s of samples) {
    for (const k of keys) {
      const v = (s.features as unknown as Record<string,number>)[k] ?? 0;
      sums[k] += v; sqSums[k] += v*v;
    }
  }
  const N = samples.length;
  const mean: Record<string,number>={}, std: Record<string,number>={};
  for (const k of keys) {
    mean[k] = sums[k]/N;
    const variance = sqSums[k]/N - mean[k]*mean[k];
    std[k] = Math.sqrt(Math.max(variance, 0.01));
  }
  return {mean, std};
}

function scale(f: FeatureVector, s: Scaler, fwd: boolean): Record<string,number> {
  const out: Record<string,number>={};
  const raw = f as unknown as Record<string,number>;
  for (const k of Object.keys(s.mean)) {
    const v = raw[k] ?? 0;
    out[k] = fwd ? (v - s.mean[k]) / s.std[k] : v;
  }
  return out;
}

// ─── Poisson Log-Linear Trainer ───

export function train(
  samples: TrainingSample[],
  lr: number = 0.001,
  epochs: number = 80,
  l2Lambda: number = 0.001
): TrainingResult {
  if (samples.length === 0) {
    return { weights: { ...DEFAULT_WEIGHTS }, finalLoss: 0, epochs: 0, samplesUsed: 0 };
  }

  // Fit standard scaler on features
  const scaler = fitScaler(samples);

  // Initialize weights in log-space
  const w: LambdaModelWeights = { ...DEFAULT_WEIGHTS };
  const N = samples.length;

  let finalLoss = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    let totalLoss = 0;

    for (const s of samples) {
      // Standardize features
      const feats = scale(s.features, scaler, true);

      // Forward: λ = exp(w · x)
      const homeLog =
        w.biasHome + w.elo*feats.eloDiff + w.xg*feats.xGDiff +
        w.xga*feats.xGADiff + w.form*feats.formDiff +
        w.injury*feats.injuryDiff + w.home*feats.homeAdvantage +
        w.odds*feats.oddsDelta;
      const lambdaPred = Math.exp(homeLog);
      const y = s.labelHomeGoals;

      // Poisson deviance loss
      // loss = λ - y·log(λ)  (ignoring constant log(y!))
      const loss = lambdaPred - y * Math.log(Math.max(lambdaPred, 0.01));
      totalLoss += loss;

      // Gradient: ∂L/∂w = (λ - y) · x_feature
      const grad = lambdaPred - y;

      // Update with L2 regularization
      w.elo    -= lr * (grad * feats.eloDiff + l2Lambda * w.elo);
      w.xg     -= lr * (grad * feats.xGDiff + l2Lambda * w.xg);
      w.xga    -= lr * (grad * feats.xGADiff + l2Lambda * w.xga);
      w.form   -= lr * (grad * feats.formDiff + l2Lambda * w.form);
      w.injury -= lr * (grad * feats.injuryDiff + l2Lambda * w.injury);
      w.home   -= lr * (grad * feats.homeAdvantage + l2Lambda * w.home);
      w.odds   -= lr * (grad * feats.oddsDelta + l2Lambda * w.odds);
    }

    // Enforce market weight ≤ 10%
    const mkt = Math.abs(w.odds);
    const core = Math.abs(w.elo)+Math.abs(w.xg)+Math.abs(w.xga)+Math.abs(w.form)+Math.abs(w.injury)+Math.abs(w.home);
    if (core > 0 && mkt/(core+mkt) > 0.10) {
      w.odds *= (0.10*core)/(0.90*mkt);
    }

    finalLoss = totalLoss / N;
  }

  return { weights: w, finalLoss: parseFloat(finalLoss.toFixed(4)), epochs, samplesUsed: N };
}

export function trainModel(samples: TrainingSample[]): LambdaModel {
  const result = train(samples);
  const model = new LambdaModel(result.weights);
  model.clampMarketWeight();
  console.log(`[TRAIN v2] ${result.samplesUsed} samples · ${result.epochs} epochs · PoissonLoss=${result.finalLoss}`);
  return model;
}
