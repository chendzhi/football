/**
 * Context Features — 从真实比赛数据计算场外特征
 *
 * 1. 赛程疲劳 (rest days since last match)
 * 2. 历史交手 (head-to-head goal difference)
 * 3. 赛事战意 (must-win vs dead rubber from group standings)
 */

import type { PrismaClient } from '@prisma/client';

export interface ContextFeatures {
  homeRestDays: number;      // 主队休息天数
  awayRestDays: number;      // 客队休息天数
  restAdvantage: number;     // normalized: (homeRest - awayRest) / 14
  h2hGoalDiff: number;       // 历史交手净胜球 (normalized)
  homeMotivation: number;    // 主队战意 0-1
  awayMotivation: number;    // 客队战意 0-1
}

/** 计算赛程疲劳 — 查找最近一场比赛距今多少天 */
async function getRestDays(
  prisma: PrismaClient, teamId: string, beforeDate: Date
): Promise<number> {
  const lastMatch = await prisma.match.findFirst({
    where: {
      status: 'completed',
      homeScore: { not: null },
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      matchDate: { lt: beforeDate },
    },
    orderBy: { matchDate: 'desc' },
  });
  if (!lastMatch) return 7; // 无历史，默认休息充足
  const days = (beforeDate.getTime() - new Date(lastMatch.matchDate).getTime()) / 86400000;
  return Math.min(30, Math.max(1, Math.round(days)));
}

/** 计算历史交手记录 — 查找两队过往交锋 */
async function getH2H(
  prisma: PrismaClient, homeId: string, awayId: string
): Promise<number> {
  const past = await prisma.match.findMany({
    where: {
      status: 'completed',
      homeScore: { not: null },
      OR: [
        { homeTeamId: homeId, awayTeamId: awayId },
        { homeTeamId: awayId, awayTeamId: homeId },
      ],
    },
  });

  if (past.length === 0) return 0;

  let goalDiff = 0;
  for (const m of past) {
    const homeIsHome = m.homeTeamId === homeId;
    const gf = homeIsHome ? m.homeScore! : m.awayScore!;
    const ga = homeIsHome ? m.awayScore! : m.homeScore!;
    goalDiff += gf - ga;
  }
  // Normalize: ±3 goals average → 1.0
  return parseFloat((goalDiff / Math.max(past.length, 1) / 3).toFixed(3));
}

/** 计算赛事战意 — 小组积分淘汰赛全覆盖 */
async function getMotivation(
  prisma: PrismaClient, teamId: string, groupName: string
): Promise<number> {
  // 淘汰赛: win-or-go-home → 最高战意
  if (groupName && groupName.match(/ROUND|QUARTER|SEMI|FINAL/i)) {
    return 1.0;
  }

  if (!groupName) return 0.5;

  const groupMatches = await prisma.match.findMany({
    where: { groupName, status: 'completed', homeScore: { not: null } },
  });

  // 计算当前积分 + 排名
  const allGroup = await prisma.match.findMany({ where: { groupName } });
  const teamIds = new Set<string>();
  for (const m of allGroup) { teamIds.add(m.homeTeamId); teamIds.add(m.awayTeamId); }
  const totalTeams = teamIds.size;
  const maxMatches = (totalTeams - 1) * 2;

  const standings: Record<string, { pts: number; played: number; gf: number; ga: number }> = {};
  for (const tid of teamIds) standings[tid] = { pts: 0, played: 0, gf: 0, ga: 0 };

  for (const m of groupMatches) {
    const h = standings[m.homeTeamId]; const a = standings[m.awayTeamId];
    if (!h || !a) continue;
    h.played++; a.played++;
    h.gf += m.homeScore!; h.ga += m.awayScore!;
    a.gf += m.awayScore!; a.ga += m.homeScore!;
    if (m.homeScore! > m.awayScore!) { h.pts += 3; }
    else if (m.homeScore === m.awayScore) { h.pts += 1; a.pts += 1; }
    else { a.pts += 3; }
  }

  const my = standings[teamId];
  if (!my) return 0.5;

  const sorted = [...teamIds].map(t => ({ id: t, ...standings[t] }))
    .sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga));
  const myRank = sorted.findIndex(t => t.id === teamId);
  const remaining = maxMatches - my.played;

  // 已出线 (rank 1-2, 剩余赛程无法被追上)
  if (remaining === 0 && myRank <= 1) return 0.2; // 无压力

  // 已淘汰
  const secondPts = sorted[1]?.pts || 0;
  if (my.pts + remaining * 3 < secondPts) return 0.9; // 荣誉战

  // 必须赢
  const thirdPts = sorted[2]?.pts || 0;
  const maxPossible = my.pts + remaining * 3;
  if (myRank >= 2 && maxPossible >= secondPts && my.pts < secondPts) {
    return 0.85 + (1 - remaining / maxMatches) * 0.15;
  }

  // 平局即可
  if (my.pts + remaining >= secondPts && myRank <= 1 && remaining > 0) {
    return 0.4 + (1 - remaining / maxMatches) * 0.3;
  }

  // 小组末轮 (remaining === 0 after played = maxMatches, i.e. last match)
  if (remaining === 0) return 0.5;

  return 0.3 + (1 - remaining / maxMatches) * 0.5;
}

/** 计算一场比赛的所有场外特征 */
export async function computeContextFeatures(
  prisma: PrismaClient,
  homeTeamId: string,
  awayTeamId: string,
  matchDate: Date,
  groupName: string
): Promise<ContextFeatures> {
  const [homeRest, awayRest, h2h, homeMot, awayMot] = await Promise.all([
    getRestDays(prisma, homeTeamId, matchDate),
    getRestDays(prisma, awayTeamId, matchDate),
    getH2H(prisma, homeTeamId, awayTeamId),
    getMotivation(prisma, homeTeamId, groupName),
    getMotivation(prisma, awayTeamId, groupName),
  ]);

  return {
    homeRestDays: homeRest,
    awayRestDays: awayRest,
    restAdvantage: parseFloat(((homeRest - awayRest) / 14).toFixed(3)),
    h2hGoalDiff: h2h,
    homeMotivation: homeMot,
    awayMotivation: awayMot,
  };
}
