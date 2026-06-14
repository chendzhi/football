/**
 * Feature Vector — Pure Statistical (Market-Free)
 *
 * 所有特征来自球队统计数据，不包含赔率/市场信号。
 * 市场层独立为 marketAdapter.ts，不参与 λ 训练。
 */

export interface FeatureVector {
  eloDiff: number;
  xGDiff: number;
  xGADiff: number;
  formDiff: number;
  injuryDiff: number;
  homeAdvantage: number;
}

export function buildFeatureVector(params: {
  homeElo: number; awayElo: number;
  homeXG: number; awayXG: number;
  homeXGA: number; awayXGA: number;
  homeForm: number; awayForm: number;
  homeInjury: number; awayInjury: number;
}): FeatureVector {
  return {
    eloDiff: params.homeElo - params.awayElo,
    xGDiff: params.homeXG - params.awayXG,
    xGADiff: params.homeXGA - params.awayXGA,
    formDiff: params.homeForm - params.awayForm,
    injuryDiff: params.homeInjury - params.awayInjury,
    homeAdvantage: 1.0,
  };
}
