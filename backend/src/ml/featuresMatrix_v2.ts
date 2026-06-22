/**
 * Feature Vector V2 — 包含交互项 (non-linear coupling)
 *
 * 新增交互项:
 *   elo_x_form:  强队 + 状态好 → 爆发式提升
 *   xg_x_rest:   攻击力 × 休息充分 → 超常发挥
 *   mot_x_def:   战意 × 对手防守弱 → 针对性打击
 *   elo_x_xg:    一致性检验 (高ELO低xG = 伪强队)
 */

export interface FeatureVectorV2 {
  // ── 基础特征 ──
  eloDiff: number;
  xGDiff: number;
  xGADiff: number;
  formDiff: number;
  injuryDiff: number;
  homeAdvantage: number;
  // ── 交互项 ──
  eloXForm: number;       // ELO diff × form diff (normalized)
  xgXRest: number;        // xG diff × rest advantage
  motXDef: number;        // motivation × opponent defense weakness
  eloXxg: number;         // ELO × xG consistency
  // ── 场外特征 ──
  restAdv: number;        // rest day advantage
  h2hAdv: number;         // H2H goal diff (normalized)
  motivation: number;     // team motivation 0-1
}

export function buildFeatureVectorV2(params: {
  homeElo: number; awayElo: number;
  homeXG: number; awayXG: number;
  homeXGA: number; awayXGA: number;
  homeForm: number; awayForm: number;
  homeInjury: number; awayInjury: number;
  restAdvantage: number;
  h2hGoalDiff: number;
  homeMotivation: number; awayMotivation: number;
}): FeatureVectorV2 {
  const eloDiff = params.homeElo - params.awayElo;
  const xGDiff = params.homeXG - params.awayXG;
  const xGADiff = params.homeXGA - params.awayXGA;
  const formDiff = params.homeForm - params.awayForm;
  const injuryDiff = params.homeInjury - params.awayInjury;

  // 交互项归一化到 [-1, 1] 区间
  const eloNorm = Math.tanh(eloDiff / 400);
  const formNorm = Math.tanh(formDiff);
  const xgNorm = Math.tanh(xGDiff);
  const restNorm = Math.tanh(params.restAdvantage);
  const motAvg = (params.homeMotivation + params.awayMotivation) / 2;
  const defWeak = Math.tanh(xGADiff); // opponent defense weakness

  return {
    eloDiff,
    xGDiff,
    xGADiff,
    formDiff,
    injuryDiff,
    homeAdvantage: 1.0,
    // 交互项
    eloXForm: parseFloat((eloNorm * formNorm).toFixed(4)),
    xgXRest: parseFloat((xgNorm * restNorm).toFixed(4)),
    motXDef: parseFloat((motAvg * defWeak).toFixed(4)),
    eloXxg: parseFloat((eloNorm * xgNorm).toFixed(4)),
    // 场外
    restAdv: params.restAdvantage,
    h2hAdv: params.h2hGoalDiff,
    motivation: motAvg,
  };
}
