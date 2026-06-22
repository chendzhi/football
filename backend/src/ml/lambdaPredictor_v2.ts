/**
 * Lambda Predictor V2 — 纯统计 λ + 贝叶斯不确定性
 *
 * Fix: 市场信息只在校准层混入 (single entry point)
 * Fix: λ 作为 LogNormal 分布, 不是点值
 */

import type { ContextFeatures } from './contextFeatures';
import { buildFeatureVectorV2 } from './featuresMatrix_v2';

export interface LambdaWeightsV2 {
  elo: number; xg: number; xga: number; form: number; injury: number; home: number;
  eloXForm: number; xgXRest: number; motXDef: number; eloXxg: number;
  rest: number; h2h: number; motivation: number;
  biasHome: number; biasAway: number;
}

export const DEFAULT_WEIGHTS_V2: LambdaWeightsV2 = {
  elo: 0.0006, xg: 0.15, xga: -0.12, form: 0.06, injury: -0.18, home: 0.03,
  eloXForm: 0.04, xgXRest: 0.02, motXDef: 0.03, eloXxg: -0.02,
  rest: 0.01, h2h: 0.01, motivation: 0.02,
  biasHome: 0.35, biasAway: 0.30,
};

let trainedWeightsV2: LambdaWeightsV2 = { ...DEFAULT_WEIGHTS_V2 };
let lambdaUncertainty: number = 0.08; // CV residual σ, updated after training

export function getWeightsV2() { return trainedWeightsV2; }
export function setWeightsV2(w: LambdaWeightsV2) { trainedWeightsV2 = w; }
export function setLambdaUncertainty(sigma: number) { lambdaUncertainty = Math.max(0.03, Math.min(0.20, sigma)); }
export function getLambdaUncertainty() { return lambdaUncertainty; }

/** 纯统计 λ (无市场) + 95% 置信区间 */
export function predictLambdaV2(params: {
  homeElo: number; awayElo: number;
  homeXG: number; awayXG: number;
  homeXGA: number; awayXGA: number;
  homeForm: number; awayForm: number;
  homeInjury: number; awayInjury: number;
  context?: ContextFeatures | null;
}): {
  homeLambda: number; awayLambda: number;
  homeCI: [number, number]; awayCI: [number, number];
} {
  const w = trainedWeightsV2;
  const ctx = params.context;

  const f = buildFeatureVectorV2({
    ...params,
    restAdvantage: ctx?.restAdvantage ?? 0,
    h2hGoalDiff: ctx?.h2hGoalDiff ?? 0,
    homeMotivation: ctx?.homeMotivation ?? 0.5,
    awayMotivation: ctx?.awayMotivation ?? 0.5,
  });

  const homeLog = w.biasHome
    + w.elo * f.eloDiff + w.xg * f.xGDiff + w.xga * f.xGADiff
    + w.form * f.formDiff + w.injury * f.injuryDiff + w.home * f.homeAdvantage
    + w.eloXForm * f.eloXForm + w.xgXRest * f.xgXRest
    + w.motXDef * f.motXDef + w.eloXxg * f.eloXxg
    + w.rest * f.restAdv + w.h2h * f.h2hAdv + w.motivation * f.motivation;

  const awayLog = w.biasAway
    + w.elo * (-f.eloDiff) + w.xg * (-f.xGDiff) + w.xga * (-f.xGADiff)
    + w.form * (-f.formDiff) + w.injury * (-f.injuryDiff)
    + w.eloXForm * (-f.eloXForm) + w.xgXRest * (-f.xgXRest)
    + w.motXDef * (-f.motXDef) + w.eloXxg * (-f.eloXxg)
    - w.rest * f.restAdv - w.h2h * f.h2hAdv - w.motivation * f.motivation;

  const homeMean = Math.exp(homeLog);
  const awayMean = Math.exp(awayLog);

  // 95% CI: μ × exp(±1.96σ) for LogNormal
  const z = 1.96;
  const homeCI: [number, number] = [
    parseFloat((homeMean * Math.exp(-z * lambdaUncertainty)).toFixed(4)),
    parseFloat((homeMean * Math.exp(z * lambdaUncertainty)).toFixed(4)),
  ];
  const awayCI: [number, number] = [
    parseFloat((awayMean * Math.exp(-z * lambdaUncertainty)).toFixed(4)),
    parseFloat((awayMean * Math.exp(z * lambdaUncertainty)).toFixed(4)),
  ];

  return {
    homeLambda: parseFloat(homeMean.toFixed(4)),
    awayLambda: parseFloat(awayMean.toFixed(4)),
    homeCI,
    awayCI,
  };
}

// ─── 动态市场信任权重 (仅在校准层使用) ───

export function computeMarketWeight(params: {
  margin: number;
  hoursToKickoff: number;
  oddsVolatility: number;
}): number {
  const liquidityScore = Math.max(0, Math.min(1, (1.12 - params.margin) / 0.10));
  const timeScore = params.hoursToKickoff < 2 ? 1.0
    : params.hoursToKickoff < 24 ? 0.8
    : params.hoursToKickoff < 72 ? 0.5 : 0.2;
  const stabilityScore = 1 - Math.min(params.oddsVolatility, 0.8);
  const raw = liquidityScore * 0.4 + timeScore * 0.3 + stabilityScore * 0.3;
  return parseFloat((0.30 + raw * 0.40).toFixed(2));
}
