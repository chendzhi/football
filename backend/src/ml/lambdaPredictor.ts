/**
 * Lambda Predictor — ML-trained λ 预测器 (lightweight, no Prisma)
 *
 * 替代 feature.ts 中硬编码系数的 computeLambda()。
 * λ = exp(bias + Σ w_i · feature_diff)
 *
 * predictLambdaML() 不依赖 Prisma，可在 Express 路由中安全调用。
 * trainModel() 依赖 Prisma，仅在 auto-sync 中调用。
 */

import { LambdaModel, DEFAULT_WEIGHTS, type LambdaModelWeights } from './lambdaModel';
import { buildFeatureVector } from './featuresMatrix';
import type { RawOddsFeatures } from '../types';
import type { ContextFeatures } from './contextFeatures';

/** 全局单例：已训练的 ML 模型 */
let trainedModel: LambdaModel | null = null;
let trainedWeights: LambdaModelWeights = { ...DEFAULT_WEIGHTS };
let lastTrainTime: Date | null = null;
let lastSampleCount: number = 0;

/**
 * 使用 ML 模型预测 λ（纯统计，轻量，无 Prisma 依赖）
 */
export function predictLambdaML(params: {
  homeElo: number; awayElo: number;
  homeXG: number; awayXG: number;
  homeXGA: number; awayXGA: number;
  homeForm: number; awayForm: number;
  homeInjury: number; awayInjury: number;
}): { homeLambda: number; awayLambda: number } {
  const features = buildFeatureVector(params);
  const model = trainedModel || new LambdaModel(trainedWeights);
  return model.predict(features);
}

/**
 * 混合 λ：ML 统计模型 + 市场赔率锚定
 */
export function computeLambdaHybrid(
  params: {
    homeElo: number; awayElo: number;
    homeXG: number; awayXG: number;
    homeXGA: number; awayXGA: number;
    homeForm: number; awayForm: number;
    homeInjury: number; awayInjury: number;
  },
  odds?: RawOddsFeatures | null,
  context?: ContextFeatures | null
): { homeLambda: number; awayLambda: number; _blend?: number } {
  const stat = predictLambdaML(params);
  let statHome = Math.max(0.1, stat.homeLambda);
  let statAway = Math.max(0.1, stat.awayLambda);

  // ── 场外特征修正 (context features, capped at ±15% total) ──
  if (context) {
    let homeAdj = 1.0, awayAdj = 1.0;
    // 休息优势: ±6% max
    homeAdj *= 1 + Math.max(-0.06, Math.min(0.06, context.restAdvantage * 0.02));
    awayAdj *= 1 - Math.max(-0.06, Math.min(0.06, context.restAdvantage * 0.02));
    // 历史交手: ±10% max
    homeAdj *= 1 + Math.max(-0.10, Math.min(0.10, context.h2hGoalDiff * 0.05));
    awayAdj *= 1 - Math.max(-0.10, Math.min(0.10, context.h2hGoalDiff * 0.05));
    // 战意: ±8% max
    homeAdj *= 0.92 + Math.max(0, Math.min(1, context.homeMotivation)) * 0.16;
    awayAdj *= 0.92 + Math.max(0, Math.min(1, context.awayMotivation)) * 0.16;
    // Total adjustment capped at ±15%
    homeAdj = Math.max(0.85, Math.min(1.15, homeAdj));
    awayAdj = Math.max(0.85, Math.min(1.15, awayAdj));
    statHome = Math.max(0.05, Math.min(6.0, statHome * homeAdj));
    statAway = Math.max(0.05, Math.min(6.0, statAway * awayAdj));
  }

  if (!odds || !odds.homeOdds || !odds.drawOdds || !odds.awayOdds) {
    return { homeLambda: statHome, awayLambda: statAway };
  }

  const h = odds.homeOdds, d = odds.drawOdds, a = odds.awayOdds;
  if (h <= 1 || d <= 1 || a <= 1) return { homeLambda: statHome, awayLambda: statAway };
  const margin = 1 / h + 1 / d + 1 / a;
  if (margin <= 1 || margin > 1.3) return { homeLambda: statHome, awayLambda: statAway };

  const pH = (1 / h) / margin;
  const totalGoals = Math.min(statHome + statAway, 5.0);
  const homeShare = 0.35 + pH * 0.55;

  const marketHome = totalGoals * homeShare;
  const marketAway = totalGoals * (1 - homeShare);

  // 动态市场权重: 流动性高 → 更信任市场, 流动性低 → 更信任统计
  // margin: 1.05 (liquid) → 1.25 (illiquid), blend: 70% → 30%
  const liquidity = Math.max(0, Math.min(1, (1.25 - margin) / 0.20));
  const BLEND = 0.30 + liquidity * 0.40;
  return {
    homeLambda: parseFloat((BLEND * marketHome + (1 - BLEND) * statHome).toFixed(4)),
    awayLambda: parseFloat((BLEND * marketAway + (1 - BLEND) * statAway).toFixed(4)),
    _blend: parseFloat(BLEND.toFixed(2)),
  };
}

/** 更新训练好的权重（由 auto-sync 调用） */
export function updateTrainedWeights(weights: LambdaModelWeights, sampleCount: number): void {
  trainedWeights = weights;
  trainedModel = new LambdaModel(weights);
  lastTrainTime = new Date();
  lastSampleCount = sampleCount;
}

/** 获取模型状态 */
export function getModelStatus() {
  return {
    trained: trainedModel !== null,
    lastTrainTime,
    lastSampleCount,
    weights: trainedWeights,
  };
}
