/**
 * Market Lambda Pre-Fusion — 市场 λ 前置融合引擎
 *
 * 核心变更: 赔率反推 λ 在特征修正前与统计 λ 加权融合
 *   旧: base λ → 特征修正 → 仿真 → 校准层赔率混合 (后置, 无法修正 λ 根源)
 *   新: base λ + market λ → 动态融合 → 特征修正 → 仿真 (前置, 从根源修正)
 *
 * 赔率包含的非公开软信息:
 *   - 训练状态、隐性伤病、战术泄露
 *   - 资金预判 (通常早于媒体官宣)
 *   - 职业精算师共识
 *
 * 融合权重由流动性 + 时效性动态决定
 */

export interface MarketLambda {
  homeLambda: number;
  awayLambda: number;
  homeImpliedProb: number;  // 去水公平主胜概率
  drawImpliedProb: number;
  awayImpliedProb: number;
  margin: number;
  liquidity: number;
  confidence: number;       // 0-1, 市场共识可信度
}

export interface FusedLambda {
  homeLambda: number;
  awayLambda: number;
  statWeight: number;       // 统计模型权重
  marketWeight: number;     // 市场模型权重
  marketLambda: MarketLambda | null;
  reason: string;
}

/**
 * 从赔率反推市场隐含 λ
 * 原理: 博彩市场包含交易员对所有软信息的定价
 * 去水提取公平概率 → 映射到预期进球
 */
export function oddsToMarketLambda(
  homeOdds: number,
  drawOdds: number,
  awayOdds: number,
  statHome: number,
  statAway: number
): MarketLambda | null {
  if (!homeOdds || !drawOdds || !awayOdds) return null;
  if (homeOdds <= 1 || drawOdds <= 1 || awayOdds <= 1) return null;

  const margin = 1 / homeOdds + 1 / drawOdds + 1 / awayOdds;
  if (margin <= 1 || margin > 1.5) return null;

  // 去水 → 公平概率
  const fairH = (1 / homeOdds) / margin;
  const fairD = (1 / drawOdds) / margin;
  const fairA = (1 / awayOdds) / margin;

  // 流动性: margin 越接近 1.0 越高
  const liquidity = Math.max(0, Math.min(1, (1.12 - margin) / 0.12));

  // 总进球保持统计模型量级，赔率只分配主客份额
  const totalGoals = Math.min(statHome + statAway, 5.5);
  // 主队份额: 公平概率经过经验映射 (市场倾向更极端)
  const homeShare = 0.30 + fairH * 0.65;

  return {
    homeLambda: parseFloat((totalGoals * homeShare).toFixed(4)),
    awayLambda: parseFloat((totalGoals * (1 - homeShare)).toFixed(4)),
    homeImpliedProb: parseFloat(fairH.toFixed(4)),
    drawImpliedProb: parseFloat(fairD.toFixed(4)),
    awayImpliedProb: parseFloat(fairA.toFixed(4)),
    margin: parseFloat(margin.toFixed(4)),
    liquidity: parseFloat(liquidity.toFixed(2)),
    confidence: parseFloat(Math.min(1, liquidity * 0.8 + 0.2).toFixed(2)),
  };
}

/**
 * 动态融合统计 λ 与市场 λ
 *
 * @param statHome 纯数据模型主队 λ
 * @param statAway 纯数据模型客队 λ
 * @param market 市场隐含 λ
 * @param hoursToKickoff 距开球小时
 * @param oddsVolatility 赔率波动
 */
export function fuseLambdas(
  statHome: number,
  statAway: number,
  market: MarketLambda | null,
  hoursToKickoff: number,
  oddsVolatility: number
): FusedLambda {
  if (!market) {
    return {
      homeLambda: statHome, awayLambda: statAway,
      statWeight: 1.0, marketWeight: 0,
      marketLambda: null,
      reason: '无赔率数据 → 100% 统计模型',
    };
  }

  // 极低流动性 (<0.1): 市场权重趋近 0
  if (market.liquidity < 0.1) {
    return {
      homeLambda: statHome, awayLambda: statAway,
      statWeight: 1.0, marketWeight: 0,
      marketLambda: market,
      reason: `流动性极低(${market.liquidity}) → 100% 统计模型`,
    };
  }

  // 时间权重: 距开球越近，市场越准
  const timeScore = hoursToKickoff < 1 ? 1.0
    : hoursToKickoff < 6 ? 0.85
    : hoursToKickoff < 24 ? 0.70
    : hoursToKickoff < 72 ? 0.50
    : 0.30;

  // 稳定性权重: 波动低 → 市场共识强
  const stabilityScore = 1 - Math.min(oddsVolatility, 0.8);

  // 流动性权重: 基本信任度
  const liquidityWeight = market.liquidity;

  // 综合市场权重: [0.15, 0.75]
  const rawWeight = liquidityWeight * 0.40 + timeScore * 0.35 + stabilityScore * 0.25;
  const marketWeight = parseFloat(Math.max(0.15, Math.min(0.75, rawWeight)).toFixed(2));
  const statWeight = parseFloat((1 - marketWeight).toFixed(2));

  // 融合 λ: 加权平均
  const fusedHome = statHome * statWeight + market.homeLambda * marketWeight;
  const fusedAway = statAway * statWeight + market.awayLambda * marketWeight;

  return {
    homeLambda: parseFloat(fusedHome.toFixed(4)),
    awayLambda: parseFloat(fusedAway.toFixed(4)),
    statWeight,
    marketWeight,
    marketLambda: market,
    reason: `${(marketWeight * 100).toFixed(0)}% 市场 + ${(statWeight * 100).toFixed(0)}% 统计 (流动=${market.liquidity} 时效=${timeScore.toFixed(2)} 稳定=${stabilityScore.toFixed(2)})`,
  };
}
