/**
 * Feature Engine v3 — Goal-Based Statistical Model
 *
 * 原则:
 *   - 只用真实比赛结果 (goals scored/conceded)
 *   - 时间衰减 form (recent > old)
 *   - ELO 真实更新公式
 *   - 不推导 xG，不用赔率
 */

import { PrismaClient } from '@prisma/client';

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

export function computeLambda(input: LambdaInput): { homeLambda: number; awayLambda: number } {
  const eloDiff = input.homeElo - input.awayElo;
  const eloFactor = 1 + (eloDiff / 400) * 0.10;
  const momentum = Math.min(input.homeForm / Math.max(input.awayForm, 0.1), 1.3);

  // Scale factor keeps λ in realistic football range [0.5, 3.0]
  const SCALE = 0.65;

  const homeLambda =
    input.homeAttack *
    input.awayDefense *
    eloFactor *
    input.homeAdvantage *
    momentum *
    SCALE;

  const awayLambda =
    input.awayAttack *
    input.homeDefense *
    (2 - Math.min(eloFactor, 1.6)) *
    (1 / input.homeAdvantage) *
    SCALE;

  return {
    homeLambda: parseFloat(Math.max(0.1, homeLambda).toFixed(4)),
    awayLambda: parseFloat(Math.max(0.1, awayLambda).toFixed(4)),
  };
}

// ─── Injury (kept for compat) ───
export function computeInjuryPenalty(
  injured: Array<{ player: { importance: number } }>
): number {
  return Math.min(injured.reduce((s, p) => s + p.player.importance, 0), 0.3);
}
