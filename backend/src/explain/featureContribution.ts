/**
 * Feature Contribution — 特征敏感性分析
 *
 * 对每个特征做 ±10% 扰动，用快速解析法（Dixon-Coles 6×6 联合矩阵求和）
 * 测量胜/平/负概率偏移。比重跑 Monte Carlo 快 1000 倍。
 */

import { dixonColesTau } from '../dixon_coles';
import { computeLambda, type LambdaInput } from '../feature';

/** 泊松概率质量函数 (内部) */
function poissonProb(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(Math.max(lambda, 0.01));
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** 快速解析法: 从 λ 直接计算胜/平/负概率 (Dixon-Coles 6×6 矩阵求和) */
function fastOutcomeProbs(homeLambda: number, awayLambda: number): {
  homeWin: number; draw: number; awayWin: number;
} {
  let homeWin = 0, draw = 0, awayWin = 0, total = 0;
  for (let x = 0; x < 6; x++) {
    for (let y = 0; y < 6; y++) {
      const px = poissonProb(x, homeLambda);
      const py = poissonProb(y, awayLambda);
      const tau = dixonColesTau(x, y, homeLambda, awayLambda);
      const p = px * py * tau;
      total += p;
      if (x > y) homeWin += p;
      else if (x < y) awayWin += p;
      else draw += p;
    }
  }
  const inv = 1 / Math.max(total, 1e-12);
  return {
    homeWin: parseFloat((homeWin * inv).toFixed(6)),
    draw: parseFloat((draw * inv).toFixed(6)),
    awayWin: parseFloat((awayWin * inv).toFixed(6)),
  };
}

export interface FeatureSensitivity {
  feature: string;
  featureKey: string;
  baseProb: { homeWin: number; draw: number; awayWin: number };
  perturbUp: { homeWin: number; draw: number; awayWin: number };
  perturbDown: { homeWin: number; draw: number; awayWin: number };
  deltaHomeWin: number;
  deltaDraw: number;
  deltaAwayWin: number;
  maxAbsoluteDelta: number;
}

export interface FeatureContributionResult {
  features: FeatureSensitivity[];
  homeWinTopContributors: FeatureSensitivity[];
  drawTopContributors: FeatureSensitivity[];
  awayWinTopContributors: FeatureSensitivity[];
}

const PERTURBATION = 0.10; // ±10%

/**
 * 特征敏感性分析:
 * 对 ELO diff / xG diff / xGA diff / form diff / home advantage 六个特征各 ±10%,
 * 用快速解析法计算胜/平/负概率偏移。
 */
export function computeFeatureContribution(
  baseInput: LambdaInput,
  _odds: any,  // kept for API compat, no longer used (single entry point)
  baseHomeLambda: number,
  baseAwayLambda: number
): FeatureContributionResult {
  // 基线概率
  const baseProb = fastOutcomeProbs(baseHomeLambda, baseAwayLambda);

  const features: FeatureSensitivity[] = [];

  // ── Feature 1: ELO Diff ──
  {
    const delta = (baseInput.homeElo - baseInput.awayElo) * PERTURBATION;
    const upInput = { ...baseInput, homeElo: baseInput.homeElo + delta / 2, awayElo: baseInput.awayElo - delta / 2 };
    const downInput = { ...baseInput, homeElo: baseInput.homeElo - delta / 2, awayElo: baseInput.awayElo + delta / 2 };
    const upResult = computeLambda(upInput);
    const downResult = computeLambda(downInput);
    const upProb = fastOutcomeProbs(upResult.homeLambda, upResult.awayLambda);
    const downProb = fastOutcomeProbs(downResult.homeLambda, downResult.awayLambda);
    features.push({
      feature: 'ELO 战力级差',
      featureKey: 'eloDiff',
      baseProb: { ...baseProb },
      perturbUp: { ...upProb },
      perturbDown: { ...downProb },
      deltaHomeWin: parseFloat((upProb.homeWin - downProb.homeWin).toFixed(4)),
      deltaDraw: parseFloat((upProb.draw - downProb.draw).toFixed(4)),
      deltaAwayWin: parseFloat((upProb.awayWin - downProb.awayWin).toFixed(4)),
      maxAbsoluteDelta: Math.max(
        Math.abs(upProb.homeWin - downProb.homeWin),
        Math.abs(upProb.draw - downProb.draw),
        Math.abs(upProb.awayWin - downProb.awayWin)
      ),
    });
  }

  // ── Feature 2: xG Diff (Attack) ──
  {
    const upInput = { ...baseInput, homeAttack: baseInput.homeAttack * (1 + PERTURBATION) };
    const downInput = { ...baseInput, homeAttack: baseInput.homeAttack * (1 - PERTURBATION) };
    const upResult = computeLambda(upInput);
    const downResult = computeLambda(downInput);
    const upProb = fastOutcomeProbs(upResult.homeLambda, upResult.awayLambda);
    const downProb = fastOutcomeProbs(downResult.homeLambda, downResult.awayLambda);
    features.push({
      feature: '硬核攻击效率 (xG)',
      featureKey: 'xgDiff',
      baseProb: { ...baseProb },
      perturbUp: { ...upProb },
      perturbDown: { ...downProb },
      deltaHomeWin: parseFloat((upProb.homeWin - downProb.homeWin).toFixed(4)),
      deltaDraw: parseFloat((upProb.draw - downProb.draw).toFixed(4)),
      deltaAwayWin: parseFloat((upProb.awayWin - downProb.awayWin).toFixed(4)),
      maxAbsoluteDelta: Math.max(
        Math.abs(upProb.homeWin - downProb.homeWin),
        Math.abs(upProb.draw - downProb.draw),
        Math.abs(upProb.awayWin - downProb.awayWin)
      ),
    });
  }

  // ── Feature 3: xGA Diff (Defense) ──
  {
    // defense: lower is better, so "up" = reduce defense (better)
    const upInput = { ...baseInput, homeDefense: baseInput.homeDefense * (1 - PERTURBATION) };
    const downInput = { ...baseInput, homeDefense: baseInput.homeDefense * (1 + PERTURBATION) };
    const upResult = computeLambda(upInput);
    const downResult = computeLambda(downInput);
    const upProb = fastOutcomeProbs(upResult.homeLambda, upResult.awayLambda);
    const downProb = fastOutcomeProbs(downResult.homeLambda, downResult.awayLambda);
    features.push({
      feature: '防守抗压能力 (xGA)',
      featureKey: 'xgaDiff',
      baseProb: { ...baseProb },
      perturbUp: { ...upProb },
      perturbDown: { ...downProb },
      deltaHomeWin: parseFloat((upProb.homeWin - downProb.homeWin).toFixed(4)),
      deltaDraw: parseFloat((upProb.draw - downProb.draw).toFixed(4)),
      deltaAwayWin: parseFloat((upProb.awayWin - downProb.awayWin).toFixed(4)),
      maxAbsoluteDelta: Math.max(
        Math.abs(upProb.homeWin - downProb.homeWin),
        Math.abs(upProb.draw - downProb.draw),
        Math.abs(upProb.awayWin - downProb.awayWin)
      ),
    });
  }

  // ── Feature 4: Form Diff ──
  {
    const upInput = { ...baseInput, homeForm: Math.min(baseInput.homeForm * (1 + PERTURBATION), 3.0) };
    const downInput = { ...baseInput, homeForm: Math.max(baseInput.homeForm * (1 - PERTURBATION), 0.1) };
    const upResult = computeLambda(upInput);
    const downResult = computeLambda(downInput);
    const upProb = fastOutcomeProbs(upResult.homeLambda, upResult.awayLambda);
    const downProb = fastOutcomeProbs(downResult.homeLambda, downResult.awayLambda);
    features.push({
      feature: '近期状态动量 (Form)',
      featureKey: 'formDiff',
      baseProb: { ...baseProb },
      perturbUp: { ...upProb },
      perturbDown: { ...downProb },
      deltaHomeWin: parseFloat((upProb.homeWin - downProb.homeWin).toFixed(4)),
      deltaDraw: parseFloat((upProb.draw - downProb.draw).toFixed(4)),
      deltaAwayWin: parseFloat((upProb.awayWin - downProb.awayWin).toFixed(4)),
      maxAbsoluteDelta: Math.max(
        Math.abs(upProb.homeWin - downProb.homeWin),
        Math.abs(upProb.draw - downProb.draw),
        Math.abs(upProb.awayWin - downProb.awayWin)
      ),
    });
  }

  // ── Feature 5: Home Advantage ──
  {
    const upInput = { ...baseInput, homeAdvantage: baseInput.homeAdvantage * (1 + PERTURBATION) };
    const downInput = { ...baseInput, homeAdvantage: baseInput.homeAdvantage * (1 - PERTURBATION) };
    const upResult = computeLambda(upInput);
    const downResult = computeLambda(downInput);
    const upProb = fastOutcomeProbs(upResult.homeLambda, upResult.awayLambda);
    const downProb = fastOutcomeProbs(downResult.homeLambda, downResult.awayLambda);
    features.push({
      feature: '主场天时地利',
      featureKey: 'homeAdv',
      baseProb: { ...baseProb },
      perturbUp: { ...upProb },
      perturbDown: { ...downProb },
      deltaHomeWin: parseFloat((upProb.homeWin - downProb.homeWin).toFixed(4)),
      deltaDraw: parseFloat((upProb.draw - downProb.draw).toFixed(4)),
      deltaAwayWin: parseFloat((upProb.awayWin - downProb.awayWin).toFixed(4)),
      maxAbsoluteDelta: Math.max(
        Math.abs(upProb.homeWin - downProb.homeWin),
        Math.abs(upProb.draw - downProb.draw),
        Math.abs(upProb.awayWin - downProb.awayWin)
      ),
    });
  }

  // ── Feature 6: Away Attack (客队攻击力) ──
  {
    const upInput = { ...baseInput, awayAttack: baseInput.awayAttack * (1 + PERTURBATION) };
    const downInput = { ...baseInput, awayAttack: baseInput.awayAttack * (1 - PERTURBATION) };
    const upResult = computeLambda(upInput);
    const downResult = computeLambda(downInput);
    const upProb = fastOutcomeProbs(upResult.homeLambda, upResult.awayLambda);
    const downProb = fastOutcomeProbs(downResult.homeLambda, downResult.awayLambda);
    features.push({
      feature: '客队攻击威胁',
      featureKey: 'awayAttack',
      baseProb: { ...baseProb },
      perturbUp: { ...upProb },
      perturbDown: { ...downProb },
      deltaHomeWin: parseFloat((upProb.homeWin - downProb.homeWin).toFixed(4)),
      deltaDraw: parseFloat((upProb.draw - downProb.draw).toFixed(4)),
      deltaAwayWin: parseFloat((upProb.awayWin - downProb.awayWin).toFixed(4)),
      maxAbsoluteDelta: Math.max(
        Math.abs(upProb.homeWin - downProb.homeWin),
        Math.abs(upProb.draw - downProb.draw),
        Math.abs(upProb.awayWin - downProb.awayWin)
      ),
    });
  }

  // 按 maxAbsoluteDelta 降序
  features.sort((a, b) => b.maxAbsoluteDelta - a.maxAbsoluteDelta);

  // 提取各方向 top 3
  const homeWinTopContributors = [...features]
    .sort((a, b) => Math.abs(b.deltaHomeWin) - Math.abs(a.deltaHomeWin))
    .slice(0, 3);
  const drawTopContributors = [...features]
    .sort((a, b) => Math.abs(b.deltaDraw) - Math.abs(a.deltaDraw))
    .slice(0, 3);
  const awayWinTopContributors = [...features]
    .sort((a, b) => Math.abs(b.deltaAwayWin) - Math.abs(a.deltaAwayWin))
    .slice(0, 3);

  return {
    features,
    homeWinTopContributors,
    drawTopContributors,
    awayWinTopContributors,
  };
}
