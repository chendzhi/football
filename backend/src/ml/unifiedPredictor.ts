/**
 * Unified Predictor V4 — 单一 Log-Linear 模型
 *
 * 解决 V3 问题: ML V2 + GLM 双重建模导致的权重冲突和λ过度修正
 *
 * 架构:
 *   ln(λ) = bias + Σ w_core · X_core + Σ w_ctx · X_ctx + Σ w_adj · X_adj
 *   λ = exp(ln(λ))
 *
 *   一个模型完成所有特征 → λ 的映射。
 *   不再有 Step4 ML → Step6 GLM → Step7 ESPN 的4次叠加。
 */

// ─── Feature Vector (all features in one pass) ───

export interface UnifiedFeatures {
  // Core (6): ELO/xG/xGA/form/injury/home
  eloDiff: number;
  xGDiff: number;
  xGADiff: number;
  formDiff: number;
  injuryDiff: number;
  homeAdvantage: number;

  // Interaction (4): elo×form, xg×rest, mot×def, elo×xg
  eloXForm: number;
  xgXRest: number;
  motXDef: number;
  eloXxg: number;

  // Context (3): rest, h2h, motivation
  restAdv: number;
  h2hAdv: number;
  motivation: number;

  // 5-category adjustments (log-space values)
  travelLog: number;        // 长途飞行 → ln(factor)
  pressureLog: number;      // 出线压力 → ln(factor)
  knockoutLog: number;      // 淘汰赛 → ln(factor)
  collusionLog: number;     // 默契球 → ln(factor)
  altitudeLog: number;      // 高原 → ln(factor)
  weatherLog: number;       // 天气 → ln(factor)
  refereeLog: number;       // 裁判 → ln(factor)
  defenseLog: number;       // 防守形态 → ln(factor)
  cleanSheetLog: number;    // 零封率 → ln(factor)
  h2hLog: number;           // H2H心理 → ln(factor)
  psychLog: number;         // 心理冲击 → ln(factor)
  streakLog: number;        // 势头 → ln(factor)
  scheduleLog: number;      // 赛程密集 → ln(factor)
  groupMatch3Log: number;   // 第三轮慢热 → ln(factor)
  homeFormLog: number;      // 主场形态 → ln(factor)
  stageWeightLog: number;   // 赛事权重 → ln(factor)

  // ESPN/Real XI
  lineupDiff: number;       // 阵容强度差
  gkQualityDiff: number;    // 门将质量差
  shotQualityDiff: number;  // 射门质量差
  cardImpact: number;       // 红黄牌影响
}

// ─── Unified Weights (all trained together) ───

export interface UnifiedWeights {
  // Core
  biasHome: number; biasAway: number;
  elo: number; xg: number; xga: number; form: number; injury: number; home: number;

  // Interaction
  eloXForm: number; xgXRest: number; motXDef: number; eloXxg: number;

  // Context
  rest: number; h2h: number; motivation: number;

  // 5-category adjustments
  travel: number; pressure: number; knockout: number; collusion: number;
  altitude: number; weather: number; referee: number;
  defense: number; cleanSheet: number; h2hPsych: number;
  psych: number; streak: number; schedule: number; groupMatch3: number;
  homeForm: number; stageWeight: number;

  // ESPN
  lineup: number; gkQuality: number; shotQuality: number; cards: number;
}

// Calibrated defaults — conservative, prevent over-adjustment on small data
export const DEFAULT_UNIFIED_WEIGHTS: UnifiedWeights = {
  biasHome: 0.35, biasAway: 0.30,
  elo: 0.0006, xg: 0.12, xga: -0.08, form: 0.05, injury: -0.15, home: 0.03,
  eloXForm: 0.03, xgXRest: 0.01, motXDef: 0.02, eloXxg: -0.01,
  rest: 0.01, h2h: 0.01, motivation: 0.02,

  // Adjustments start at conservative values
  travel: 0.6, pressure: 0.4, knockout: 0.3, collusion: 0.5,
  altitude: 0.4, weather: 0.3, referee: 0.2,
  defense: 0.6, cleanSheet: 0.4, h2hPsych: 0.3,
  psych: 0.7, streak: 0.4, schedule: 0.3, groupMatch3: 0.3,
  homeForm: 0.3, stageWeight: 0.3,

  lineup: 0.8, gkQuality: 0.5, shotQuality: 0.3, cards: 0.4,
};

// ─── Global trained weights ───

let trainedWeights: UnifiedWeights = { ...DEFAULT_UNIFIED_WEIGHTS };

export function getUnifiedWeights(): UnifiedWeights { return trainedWeights; }
export function setUnifiedWeights(w: Partial<UnifiedWeights>): void {
  trainedWeights = { ...trainedWeights, ...w };
}

// ─── Single-pass prediction ───

export function predictUnified(features: UnifiedFeatures): {
  homeLambda: number;
  awayLambda: number;
  homeCI: [number, number];
  awayCI: [number, number];
} {
  const w = trainedWeights;
  const f = features;

  // Home log-λ = bias + Σ w_i · f_i
  const homeLog =
    w.biasHome
    + w.elo * f.eloDiff + w.xg * f.xGDiff + w.xga * f.xGADiff
    + w.form * f.formDiff + w.injury * f.injuryDiff + w.home * f.homeAdvantage
    + w.eloXForm * f.eloXForm + w.xgXRest * f.xgXRest
    + w.motXDef * f.motXDef + w.eloXxg * f.eloXxg
    + w.rest * f.restAdv + w.h2h * f.h2hAdv + w.motivation * f.motivation
    // 5-category adjustments (already in log-space)
    + w.travel * f.travelLog + w.pressure * f.pressureLog
    + w.knockout * f.knockoutLog + w.collusion * f.collusionLog
    + w.altitude * f.altitudeLog + w.weather * f.weatherLog
    + w.referee * f.refereeLog
    + w.defense * f.defenseLog + w.cleanSheet * f.cleanSheetLog
    + w.h2hPsych * f.h2hLog + w.psych * f.psychLog
    + w.streak * f.streakLog + w.schedule * f.scheduleLog
    + w.groupMatch3 * f.groupMatch3Log + w.homeForm * f.homeFormLog
    + w.stageWeight * f.stageWeightLog
    // ESPN features
    + w.lineup * f.lineupDiff + w.gkQuality * f.gkQualityDiff
    + w.shotQuality * f.shotQualityDiff + w.cards * f.cardImpact;

  // Away log-λ = bias + Σ w_i · (-f_i) for directional features
  const awayLog =
    w.biasAway
    + w.elo * (-f.eloDiff) + w.xg * (-f.xGDiff) + w.xga * (-f.xGADiff)
    + w.form * (-f.formDiff) + w.injury * (-f.injuryDiff)
    + w.eloXForm * (-f.eloXForm) + w.xgXRest * (-f.xgXRest)
    + w.motXDef * (-f.motXDef) + w.eloXxg * (-f.eloXxg)
    - w.rest * f.restAdv - w.h2h * f.h2hAdv - w.motivation * f.motivation
    // Adjustments: symmetric impact (travel/weather affect both sides equally)
    + w.travel * f.travelLog + w.pressure * (-f.pressureLog)
    + w.knockout * f.knockoutLog + w.collusion * f.collusionLog
    + w.altitude * (-f.altitudeLog) + w.weather * f.weatherLog
    + w.referee * f.refereeLog
    + w.defense * (-f.defenseLog) + w.cleanSheet * (-f.cleanSheetLog)
    + w.h2hPsych * (-f.h2hLog) + w.psych * (-f.psychLog)
    + w.streak * (-f.streakLog) + w.schedule * f.scheduleLog
    + w.groupMatch3 * f.groupMatch3Log + w.homeForm * (-f.homeFormLog)
    + w.stageWeight * f.stageWeightLog
    + w.lineup * (-f.lineupDiff) + w.gkQuality * (-f.gkQualityDiff)
    + w.shotQuality * (-f.shotQualityDiff) + w.cards * (-f.cardImpact);

  const homeLambda = parseFloat(Math.exp(homeLog).toFixed(4));
  const awayLambda = parseFloat(Math.exp(awayLog).toFixed(4));

  // Uncertainty: residual sigma from calibration
  const sigma = 0.10;
  const z = 1.96;
  const homeCI: [number, number] = [
    parseFloat((homeLambda * Math.exp(-z * sigma)).toFixed(4)),
    parseFloat((homeLambda * Math.exp(z * sigma)).toFixed(4)),
  ];
  const awayCI: [number, number] = [
    parseFloat((awayLambda * Math.exp(-z * sigma)).toFixed(4)),
    parseFloat((awayLambda * Math.exp(z * sigma)).toFixed(4)),
  ];

  return { homeLambda, awayLambda, homeCI, awayCI };
}
