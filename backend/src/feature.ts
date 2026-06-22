/**
 * Feature Engine v4 — Market-Driven Hybrid Model
 *
 * 原则:
 *   - 赔率驱动 λ (市场是最准的预测信号)
 *   - 统计模型辅助 (ELO + xG 作为 secondary signal)
 *   - 时间衰减 form (recent > old)
 *   - ELO 真实更新公式
 */

import { PrismaClient } from '@prisma/client';
import { RawOddsFeatures } from './types';

// ─── ELO ───
export function eloExpected(eloA: number, eloB: number): number {
  return 1 / (1 + Math.pow(10, -(eloA - eloB) / 400));
}

export function eloUpdate(elo: number, expected: number, actual: number, K: number = 20): number {
  return Math.round(elo + K * (actual - expected));
}

// ─── Goal-Based Form (time-decay weighted) ───
export function computeForm(recentMatches: Array<{ goals: number; daysAgo: number }>): number {
  if (recentMatches.length === 0) return 0.5;
  let weightedSum = 0, weightSum = 0;
  for (const m of recentMatches) {
    const w = Math.exp(-m.daysAgo / 60); // half-life ~42 days
    weightedSum += m.goals * w;
    weightSum += w;
  }
  return weightSum > 0 ? weightedSum / weightSum : 0.5;
}

// ─── Attack / Defense from real goals ───
export function computeAttack(goalsScored: number, matches: number): number {
  return matches > 0 ? goalsScored / matches : 1.0;
}

export function computeDefense(goalsConceded: number, matches: number): number {
  return matches > 0 ? goalsConceded / matches : 1.0;
}

// ─── Strength from DB ───
export interface TeamGoalStats {
  attack: number;     // avg goals scored
  defense: number;    // avg goals conceded (lower = better)
  form: number;       // time-decay weighted recent goals
  elo: number;
}

export async function getTeamGoalStats(
  prisma: PrismaClient, teamId: string
): Promise<TeamGoalStats> {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  const completed = await prisma.match.findMany({
    where: {
      status: 'completed', homeScore: { not: null }, awayScore: { not: null },
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
    },
    orderBy: { matchDate: 'desc' },
  });

  let gf = 0, ga = 0;
  const recent: Array<{ goals: number; daysAgo: number }> = [];
  const now = new Date();

  for (const m of completed) {
    const isHome = m.homeTeamId === teamId;
    const goals = isHome ? m.homeScore! : m.awayScore!;
    const conceded = isHome ? m.awayScore! : m.homeScore!;
    gf += goals; ga += conceded;
    const daysAgo = (now.getTime() - new Date(m.matchDate).getTime()) / 86400000;
    recent.push({ goals, daysAgo });
  }

  return {
    attack: parseFloat(computeAttack(gf, completed.length).toFixed(3)),
    defense: parseFloat(computeDefense(ga, completed.length).toFixed(3)),
    form: parseFloat(computeForm(recent.slice(0, 5)).toFixed(3)),
    elo: team?.eloRating || 1500,
  };
}

// ─── λ = attack × defense × elo_factor × home_adv ───
export interface LambdaInput {
  homeAttack: number; awayAttack: number;
  homeDefense: number; awayDefense: number;
  homeForm: number; awayForm: number;
  homeElo: number; awayElo: number;
  homeAdvantage: number;
}

/** Intermediate values computed during lambda calculation */
export interface LambdaIntermediates {
  eloDiffRaw: number;
  eloDiffCapped: number;
  eloFactor: number;
  momentum: number;
  statHomeRaw: number;
  statAwayRaw: number;
  statHomeClamped: number;
  statAwayClamped: number;
  hasMarket: boolean;
  marketHomeLambda: number | null;
  marketAwayLambda: number | null;
  blendWeight: number;
  homeAdvantage: number;
  SCALE: number;
}

export interface ComputeLambdaResult {
  homeLambda: number;
  awayLambda: number;
  intermediates: LambdaIntermediates;
}

/**
 * 从竞彩 HAD 赔率反推市场隐含预期进球 (λ)
 *
 * 原理: 博彩市场是足球预测最准确的信号源。
 * 通过去除水位(margin)、提取隐含概率、映射到预期进球，
 * 得到市场对每队进球的"共识预期"。
 */
export function oddsToLambdas(odds: RawOddsFeatures, statHome: number, statAway: number): { homeLambda: number; awayLambda: number } | null {
  const { homeOdds, drawOdds, awayOdds } = odds;
  if (!homeOdds || !drawOdds || !awayOdds) return null;
  if (homeOdds <= 1 || drawOdds <= 1 || awayOdds <= 1) return null;

  // 1. 去水
  const margin = 1 / homeOdds + 1 / drawOdds + 1 / awayOdds;
  if (margin <= 1 || margin > 1.3) return null;

  const pH = (1 / homeOdds) / margin;

  // 2. 保持统计模型的 totalGoals（不让赔率歪曲总量）
  const totalGoals = Math.min(statHome + statAway, 5.0);

  // 3. 赔率只用来分配主客份额（告诉方向，不告诉量级）
  const homeShare = 0.35 + pH * 0.55; // pH=0.5→62%, pH=0.85→82%

  return {
    homeLambda: parseFloat((totalGoals * homeShare).toFixed(4)),
    awayLambda: parseFloat((totalGoals * (1 - homeShare)).toFixed(4)),
  };
}

/**
 * 混合 λ 计算: 75% 市场赔率 + 25% 统计模型
 *
 * - 有赔率 → 锚定市场共识，统计模型微调
 * - 无赔率 → 纯统计模型 (提高 SCALE、放宽 clamp)
 */
export function computeLambda(
  input: LambdaInput
): ComputeLambdaResult {
  // ── 统计模型 λ (ELO + xG) ──
  const rawDiff = input.homeElo - input.awayElo;
  // Taper ELO: beyond 300pt gap, marginal effect halves
  const cappedDiff = Math.abs(rawDiff) > 300
    ? 300 + (Math.abs(rawDiff) - 300) * 0.5
    : Math.abs(rawDiff);
  const eloDiff = cappedDiff * Math.sign(rawDiff);
  const eloFactor = 1 + (eloDiff / 400) * 0.12;
  const momentum = Math.min(input.homeForm / Math.max(input.awayForm, 0.1), 1.3);

  const statHomeLambda =
    input.homeAttack *
    input.awayDefense *
    eloFactor *
    input.homeAdvantage *
    momentum;

  const statAwayLambda =
    input.awayAttack *
    input.homeDefense *
    (2 - Math.min(eloFactor, 1.6)) *
    (1 / input.homeAdvantage);

  // Improved soft clamp: gentler transition starting at 3.5 with 50% taper
  const softClamp = (x: number) => x > 3.5 ? 3.5 + (x - 3.5) * 0.50 : x;
  const statHome = Math.max(0.1, softClamp(statHomeLambda));
  const statAway = Math.max(0.1, softClamp(statAwayLambda));

  // Return PURE statistical λ — market blending only at calibration layer (single entry)
  return {
    homeLambda: parseFloat(statHome.toFixed(4)),
    awayLambda: parseFloat(statAway.toFixed(4)),
    intermediates: {
      eloDiffRaw: rawDiff,
      eloDiffCapped: eloDiff,
      eloFactor,
      momentum,
      statHomeRaw: statHomeLambda,
      statAwayRaw: statAwayLambda,
      statHomeClamped: statHome,
      statAwayClamped: statAway,
      hasMarket: false,
      marketHomeLambda: null,
      marketAwayLambda: null,
      blendWeight: 0,
      homeAdvantage: input.homeAdvantage,
      SCALE: 1.0,
    },
  };
}

// ─── Injury (kept for compat) ───
export function computeInjuryPenalty(
  injured: Array<{ player: { importance: number } }>
): number {
  return Math.min(injured.reduce((s, p) => s + p.player.importance, 0), 0.3);
}
