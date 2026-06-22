/**
 * Lambda Breakdown — 将 λ 分解为各组件贡献
 *
 * 原理: 统计 λ 是乘法模型:
 *   λ_home = attack_home × defense_away × eloFactor × homeAdv × momentum × SCALE
 * 在对数空间中转换为加性贡献，从而计算每个组件的百分比贡献。
 */

import type { LambdaIntermediates } from '../feature';

export interface ComponentContribution {
  component: string;        // e.g. "ELO 差值因子", "主场优势"
  rawValue: number;         // 乘数值 (e.g. 1.08 for eloFactor)
  logContribution: number;  // ln(rawValue), 带符号
  absoluteContribution: number;
  percentage: number;       // 百分比贡献
}

export interface TeamLambdaBreakdown {
  final: number;
  base: number;             // multiplicative identity baseline
  details: ComponentContribution[];
}

export interface LambdaBreakdownResult {
  home: TeamLambdaBreakdown;
  away: TeamLambdaBreakdown;
}

/**
 * 将 LambdaIntermediates + attack/defense 分解为各组件贡献
 */
export function decomposeLambda(
  intermediates: LambdaIntermediates,
  homeAttack: number,
  awayAttack: number,
  homeDefense: number,
  awayDefense: number
): LambdaBreakdownResult {
  const home = decomposeHome(intermediates, homeAttack, awayDefense);
  const away = decomposeAway(intermediates, awayAttack, homeDefense);
  return { home, away };
}

function decomposeHome(
  inter: LambdaIntermediates,
  attack: number,
  oppDefense: number
): TeamLambdaBreakdown {
  const { homeAdvantage, momentum, eloFactor, SCALE, statHomeClamped, statAwayClamped } = inter;

  // 乘法因子列表 (component名, 原始乘数)
  const factors: Array<{ component: string; raw: number }> = [
    { component: '攻击强度 (Attack)', raw: attack },
    { component: '对手防守漏洞 (Opp. Defense)', raw: oppDefense },
    { component: 'ELO 差值因子', raw: eloFactor },
    { component: '主场天时优势', raw: homeAdvantage },
    { component: '近期状态动量', raw: momentum },
  ];

  // SCALE is identity (=1.0), skip it but note it
  if (SCALE !== 1.0) {
    factors.push({ component: '校准系数 (SCALE)', raw: SCALE });
  }

  // 计算 log 贡献
  const details: ComponentContribution[] = factors.map(f => ({
    component: f.component,
    rawValue: +f.raw.toFixed(4),
    logContribution: Math.log(Math.max(f.raw, 0.001)),
    absoluteContribution: 0, // computed below
    percentage: 0,
  }));

  const totalAbsLog = details.reduce((sum, d) => sum + Math.abs(d.logContribution), 0);

  // 计算百分比和绝对贡献
  const finalRaw = statHomeClamped;
  const detailTotal = totalAbsLog > 0 ? totalAbsLog : 1e-6;
  for (const d of details) {
    d.percentage = parseFloat(((Math.abs(d.logContribution) / detailTotal) * 100).toFixed(1));
    // 绝对贡献 = final λ * (this component's share)
    d.absoluteContribution = parseFloat(
      (finalRaw * (Math.abs(d.logContribution) / detailTotal)).toFixed(3)
    );
  }

  // 如果有市场赔率，添加混合信息
  if (inter.hasMarket) {
    const statWeight = 1 - inter.blendWeight;
    const marketWeight = inter.blendWeight;
    details.push({
      component: '统计模型基础 (40% 权重)',
      rawValue: statWeight,
      logContribution: Math.log(Math.max(statWeight, 0.001)),
      absoluteContribution: parseFloat((finalRaw * statWeight).toFixed(3)),
      percentage: parseFloat((((Math.abs(Math.log(Math.max(statWeight, 0.001)))) / (detailTotal + 3)) * 100).toFixed(1)),
    });
    details.push({
      component: '市场赔率锚定 (60% 权重)',
      rawValue: marketWeight,
      logContribution: Math.log(Math.max(marketWeight, 0.001)),
      absoluteContribution: parseFloat((finalRaw * marketWeight).toFixed(3)),
      percentage: parseFloat((((Math.abs(Math.log(Math.max(marketWeight, 0.001)))) / (detailTotal + 3)) * 100).toFixed(1)),
    });
  }

  return {
    final: +(inter.hasMarket
      ? inter.blendWeight * (inter.marketHomeLambda ?? 0) + (1 - inter.blendWeight) * statHomeClamped
      : statHomeClamped).toFixed(4),
    base: 1.0,
    details,
  };
}

function decomposeAway(
  inter: LambdaIntermediates,
  attack: number,
  oppDefense: number
): TeamLambdaBreakdown {
  const { homeAdvantage, momentum, eloFactor, SCALE, statAwayClamped } = inter;

  // 客队公式: awayAttack × homeDefense × (2 - min(eloFactor, 1.6)) × (1/homeAdv) × SCALE
  const awayEloFactor = 2 - Math.min(eloFactor, 1.6);

  const factors: Array<{ component: string; raw: number }> = [
    { component: '攻击强度 (Attack)', raw: attack },
    { component: '对手防守漏洞 (Opp. Defense)', raw: oppDefense },
    { component: 'ELO 差值反向因子', raw: awayEloFactor },
    { component: '客场劣势 (1/主场优势)', raw: 1 / homeAdvantage },
    { component: '近期状态动量', raw: Math.min(momentum, 1.3) },
  ];

  if (SCALE !== 1.0) {
    factors.push({ component: '校准系数 (SCALE)', raw: SCALE });
  }

  const details: ComponentContribution[] = factors.map(f => ({
    component: f.component,
    rawValue: +f.raw.toFixed(4),
    logContribution: Math.log(Math.max(f.raw, 0.001)),
    absoluteContribution: 0,
    percentage: 0,
  }));

  const totalAbsLog = details.reduce((sum, d) => sum + Math.abs(d.logContribution), 0);
  const finalRaw = statAwayClamped;
  const detailTotal = totalAbsLog > 0 ? totalAbsLog : 1e-6;
  for (const d of details) {
    d.percentage = parseFloat(((Math.abs(d.logContribution) / detailTotal) * 100).toFixed(1));
    d.absoluteContribution = parseFloat(
      (finalRaw * (Math.abs(d.logContribution) / detailTotal)).toFixed(3)
    );
  }

  if (inter.hasMarket) {
    const statWeight = 1 - inter.blendWeight;
    const marketWeight = inter.blendWeight;
    details.push({
      component: '统计模型基础 (40% 权重)',
      rawValue: statWeight,
      logContribution: Math.log(Math.max(statWeight, 0.001)),
      absoluteContribution: parseFloat((finalRaw * statWeight).toFixed(3)),
      percentage: parseFloat((((Math.abs(Math.log(Math.max(statWeight, 0.001)))) / (detailTotal + 3)) * 100).toFixed(1)),
    });
    details.push({
      component: '市场赔率锚定 (60% 权重)',
      rawValue: marketWeight,
      logContribution: Math.log(Math.max(marketWeight, 0.001)),
      absoluteContribution: parseFloat((finalRaw * marketWeight).toFixed(3)),
      percentage: parseFloat((((Math.abs(Math.log(Math.max(marketWeight, 0.001)))) / (detailTotal + 3)) * 100).toFixed(1)),
    });
  }

  return {
    final: +(inter.hasMarket
      ? inter.blendWeight * (inter.marketAwayLambda ?? 0) + (1 - inter.blendWeight) * statAwayClamped
      : statAwayClamped).toFixed(4),
    base: 1.0,
    details,
  };
}
