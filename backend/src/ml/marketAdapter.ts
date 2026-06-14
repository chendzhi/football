/**
 * Market Adapter — Optional, Post-Prediction Calibration Layer
 *
 * 不参与 λ 训练。只在真实 SPF 赔率到账后，
 * 对模型输出做轻度市场校准（blend ≤ 20%）。
 *
 * 使用时机：竞彩 API 返回有效 SPF 赔率时启用。
 */

export interface MarketSignal {
  homeOdds: number;
  drawOdds: number;
  awayOdds: number;
}

/**
 * Extract implied probabilities from decimal odds.
 */
export function impliedProbability(odds: MarketSignal): {
  home: number; draw: number; away: number;
} {
  const raw = {
    home: 1 / odds.homeOdds,
    draw: 1 / odds.drawOdds,
    away: 1 / odds.awayOdds,
  };
  const sum = raw.home + raw.draw + raw.away;
  return {
    home: raw.home / sum,
    draw: raw.draw / sum,
    away: raw.away / sum,
  };
}

/**
 * Blend model probability with market implied probability.
 *
 * @param modelProb — pure statistical model output
 * @param marketProb — market-implied probability from real odds
 * @param blend — market weight (0.15–0.25 recommended)
 */
export function blendWithMarket(
  modelProb: number,
  marketProb: number,
  blend: number = 0.20
): number {
  return modelProb * (1 - blend) + marketProb * blend;
}

/**
 * Compute edge: model's deviation from market.
 * Positive = model thinks market underestimated this outcome.
 * Only meaningful with real market odds.
 */
export function computeEdge(
  modelProb: number,
  marketProb: number
): number {
  return parseFloat((modelProb - marketProb).toFixed(4));
}

// To enable when real SPF odds arrive from sporttery.cn:
//   import { applyMarketAdjustment } from './marketAdapter'
//   const calibrated = applyMarketAdjustment(rawProb, realOdds)
