/**
 * Advanced Feature Engine — 全量可量化场外特征
 *
 * 用数据库已有比赛数据计算:
 *   近N场滚动统计 / 零封率 / 连胜连败 / 心理冲击 /
 *   主客场分离 / H2H细化 / 出线压力 / 淘汰赛标记
 *
 * 全部 0 外部依赖，纯 DB 计算。
 */

import type { PrismaClient } from '@prisma/client';

// ─── Types ───

export interface RollingStats {
  gf: number;              // 近N场场均进球
  ga: number;              // 近N场场均失球
  cleanSheets: number;     // 近N场零封率 0-1
  unbeatenStreak: number;  // 连续不败场次
  losingStreak: number;    // 连续输球场次
  lastGoalDiff: number;    // 最近一场净胜球 (心理冲击)
  n: number;               // 实际样本数
}

export interface SeparatedStats {
  homeGF: number;          // 近10主场场均进球
  homeGA: number;
  homeCleanSheets: number;
  awayGF: number;          // 近10客场场均进球
  awayGA: number;
  awayCleanSheets: number;
}

export interface H2HDetail {
  meetings: number;
  goalDiff: number;        // 主队视角净胜球总和
  avgTotalGoals: number;
  drawRate: number;        // 平局率
  last3Results: string;    // e.g. "WDL" from home perspective
}

export interface QualificationPressure {
  mustWin: boolean;        // 必须赢才能出线
  canDraw: boolean;        // 平局即可出线
  alreadyQualified: boolean; // 已出线
  alreadyEliminated: boolean; // 已淘汰
  pressureScore: number;   // 0-1, higher = more desperate
  opponentPressure: number;
}

export interface AdvancedFeatures {
  rolling6: RollingStats;
  separated: SeparatedStats;
  h2hDetail: H2HDetail;
  qualPressure: QualificationPressure;
  isKnockout: boolean;
}

// ─── 近N场滚动统计 ───

export async function computeRollingStats(
  prisma: PrismaClient,
  teamId: string,
  beforeDate: Date,
  n: number = 6
): Promise<RollingStats> {
  const matches = await prisma.match.findMany({
    where: {
      status: 'completed',
      homeScore: { not: null },
      awayScore: { not: null },
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      matchDate: { lt: beforeDate },
    },
    orderBy: { matchDate: 'desc' },
    take: n,
  });

  if (matches.length === 0) {
    return { gf: 1.3, ga: 1.2, cleanSheets: 0, unbeatenStreak: 0, losingStreak: 0, lastGoalDiff: 0, n: 0 };
  }

  let gf = 0, ga = 0, cs = 0;
  let unbeaten = 0, losing = 0;

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const isHome = m.homeTeamId === teamId;
    const scored = isHome ? m.homeScore! : m.awayScore!;
    const conc = isHome ? m.awayScore! : m.homeScore!;
    gf += scored; ga += conc;
    if (conc === 0) cs++;

    // Streak tracking (matches are ordered desc by date, i=0 is most recent)
    if (scored > conc) {
      if (losing === 0 && (i === 0 || unbeaten >= 0)) unbeaten++;
      else break;
    } else if (scored === conc) {
      if (losing === 0) unbeaten++; // draw counts as unbeaten
      else break;
    } else {
      if (unbeaten === 0 && (i === 0 || losing >= 0)) losing++;
      else break;
    }
  }

  // Lose streak from most recent
  let loseStreak = 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const isHome = m.homeTeamId === teamId;
    const scored = isHome ? m.homeScore! : m.awayScore!;
    const conc = isHome ? m.awayScore! : m.homeScore!;
    if (scored < conc) loseStreak++;
    else break;
  }

  const lastM = matches[0];
  const lastIsHome = lastM.homeTeamId === teamId;
  const lastGD = lastIsHome
    ? lastM.homeScore! - lastM.awayScore!
    : lastM.awayScore! - lastM.homeScore!;

  return {
    gf: gf / matches.length,
    ga: ga / matches.length,
    cleanSheets: cs / matches.length,
    unbeatenStreak: unbeaten,
    losingStreak: loseStreak,
    lastGoalDiff: lastGD,
    n: matches.length,
  };
}

// ─── 主客场分离 ───

export async function computeSeparatedStats(
  prisma: PrismaClient,
  teamId: string,
  beforeDate: Date,
  n: number = 10
): Promise<SeparatedStats> {
  const homeMatches = await prisma.match.findMany({
    where: {
      status: 'completed', homeScore: { not: null },
      homeTeamId: teamId, matchDate: { lt: beforeDate },
    },
    orderBy: { matchDate: 'desc' }, take: n,
  });
  const awayMatches = await prisma.match.findMany({
    where: {
      status: 'completed', awayScore: { not: null },
      awayTeamId: teamId, matchDate: { lt: beforeDate },
    },
    orderBy: { matchDate: 'desc' }, take: n,
  });

  const avg = (ms: any[], isHome: boolean) => {
    if (ms.length === 0) return { gf: 1.3, ga: 1.2, cs: 0 };
    let gf = 0, ga = 0, cs = 0;
    for (const m of ms) {
      const s = isHome ? m.homeScore! : m.awayScore!;
      const c = isHome ? m.awayScore! : m.homeScore!;
      gf += s; ga += c;
      if (c === 0) cs++;
    }
    return { gf: gf / ms.length, ga: ga / ms.length, cs: cs / ms.length };
  };

  const h = avg(homeMatches, true);
  const a = avg(awayMatches, false);

  return {
    homeGF: h.gf, homeGA: h.ga, homeCleanSheets: h.cs,
    awayGF: a.gf, awayGA: a.ga, awayCleanSheets: a.cs,
  };
}

// ─── H2H 细化 ───

export async function computeH2HDetail(
  prisma: PrismaClient,
  homeId: string,
  awayId: string
): Promise<H2HDetail> {
  const past = await prisma.match.findMany({
    where: {
      status: 'completed',
      homeScore: { not: null },
      OR: [
        { homeTeamId: homeId, awayTeamId: awayId },
        { homeTeamId: awayId, awayTeamId: homeId },
      ],
    },
    orderBy: { matchDate: 'desc' },
    take: 10,
  });

  if (past.length === 0) {
    return { meetings: 0, goalDiff: 0, avgTotalGoals: 0, drawRate: 0, last3Results: '' };
  }

  let goalDiff = 0, totalGoals = 0, draws = 0;
  const results: string[] = [];

  for (const m of past) {
    const homeIsMainHome = m.homeTeamId === homeId;
    const gf = homeIsMainHome ? m.homeScore! : m.awayScore!;
    const ga = homeIsMainHome ? m.awayScore! : m.homeScore!;
    goalDiff += gf - ga;
    totalGoals += gf + ga;
    if (gf === ga) draws++;
    results.push(gf > ga ? 'W' : gf === ga ? 'D' : 'L');
  }

  return {
    meetings: past.length,
    goalDiff,
    avgTotalGoals: totalGoals / past.length,
    drawRate: draws / past.length,
    last3Results: results.slice(0, 3).join(''),
  };
}

// ─── 出线压力精确计算 ───

export async function computeQualificationPressure(
  prisma: PrismaClient,
  teamId: string,
  groupName: string,
  isKnockout: boolean
): Promise<QualificationPressure> {
  const base: QualificationPressure = {
    mustWin: false, canDraw: false,
    alreadyQualified: false, alreadyEliminated: false,
    pressureScore: 0.5, opponentPressure: 0.5,
  };

  // 淘汰赛: 两边都是 must-win
  if (isKnockout || !groupName || groupName.match(/ROUND|QUARTER|SEMI|FINAL/i)) {
    base.pressureScore = 1.0;
    base.opponentPressure = 1.0;
    base.mustWin = true;
    return base;
  }

  const groupMatches = await prisma.match.findMany({
    where: { groupName, status: 'completed', homeScore: { not: null } },
  });

  if (groupMatches.length === 0) return base;

  // 计算所有小组队伍的积分
  const allGroupMatches = await prisma.match.findMany({
    where: { groupName },
  });
  const teamIds = new Set<string>();
  for (const m of allGroupMatches) { teamIds.add(m.homeTeamId); teamIds.add(m.awayTeamId); }
  const teamList = [...teamIds];

  const standings: Record<string, { pts: number; played: number; gf: number; ga: number }> = {};
  for (const tid of teamList) standings[tid] = { pts: 0, played: 0, gf: 0, ga: 0 };

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

  const totalTeams = teamList.length;
  const maxMatches = (totalTeams - 1) * 2;
  const remaining = Math.max(0, maxMatches - standings[teamId]?.played || 0);

  // Sort standings
  const sorted = teamList.map(t => ({ id: t, ...standings[t] }))
    .sort((a, b) => b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga));

  const myRank = sorted.findIndex(t => t.id === teamId);
  const myPts = standings[teamId]?.pts || 0;

  if (sorted.length >= 3) {
    const thirdPts = sorted[2]?.pts || 0;
    const secondPts = sorted[1]?.pts || 0;
    const firstPts = sorted[0]?.pts || 0;
    const maxPossiblePts = myPts + remaining * 3;

    // 已出线 (top 2 unreachable by 3rd place)
    if (myRank <= 1 && remaining === 0 && myPts > thirdPts) {
      base.alreadyQualified = true;
      base.pressureScore = 0.2;
    }
    // 已淘汰 (cannot reach 2nd place)
    else if (maxPossiblePts < secondPts) {
      base.alreadyEliminated = true;
      base.pressureScore = 0.9; // 荣誉战
    }
    // 必须赢才能出线
    else if (myRank >= 2 && maxPossiblePts >= secondPts && myPts < secondPts) {
      base.mustWin = true;
      base.pressureScore = 0.85 + (1 - remaining / maxMatches) * 0.15;
    }
    // 平局即可
    else if (myPts + remaining >= secondPts && myRank <= 1) {
      base.canDraw = true;
      base.pressureScore = 0.4 + (1 - remaining / maxMatches) * 0.3;
    }
    // 争小组第一
    else if (myRank === 1 && remaining > 0) {
      base.pressureScore = 0.5;
    }
    // 一般压力
    else {
      base.pressureScore = 0.5 + (1 - remaining / maxMatches) * 0.25;
    }
  }

  base.pressureScore = parseFloat(Math.min(1, Math.max(0.1, base.pressureScore)).toFixed(3));
  return base;
}

// ─── 主入口: 计算所有高级特征 ───

export async function computeAllAdvancedFeatures(
  prisma: PrismaClient,
  homeTeamId: string,
  awayTeamId: string,
  matchDate: Date,
  groupName: string,
  stage: string
): Promise<AdvancedFeatures> {
  const isKnockout = !!(stage && stage.match(/ROUND|QUARTER|SEMI|FINAL/i));

  const [
    homeRolling, awayRolling,
    homeSep, awaySep,
    h2hDetail,
    homePressure, awayPressure,
  ] = await Promise.all([
    computeRollingStats(prisma, homeTeamId, matchDate),
    computeRollingStats(prisma, awayTeamId, matchDate),
    computeSeparatedStats(prisma, homeTeamId, matchDate),
    computeSeparatedStats(prisma, awayTeamId, matchDate),
    computeH2HDetail(prisma, homeTeamId, awayTeamId),
    computeQualificationPressure(prisma, homeTeamId, groupName, isKnockout),
    computeQualificationPressure(prisma, awayTeamId, groupName, isKnockout),
  ]);

  return {
    rolling6: homeRolling,
    separated: homeSep,
    h2hDetail,
    qualPressure: { ...homePressure, opponentPressure: awayPressure.pressureScore },
    isKnockout,
  };
}
