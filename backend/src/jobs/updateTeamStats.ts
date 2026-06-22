/**
 * 从真实比赛结果动态计算 TeamStats (xGF, xGA, form)
 *
 * 使用回归均值 (regression to the mean) 防止单场比赛造成极端值。
 * 每次 auto-sync 拿到新比分后调用。
 */

import type { PrismaClient } from '@prisma/client';

function blendFactor(n: number): number {
  if (n <= 1) return 0.3;
  if (n <= 2) return 0.5;
  if (n <= 4) return 0.7;
  return 0.9;
}

export async function updateAllTeamStats(prisma: PrismaClient): Promise<string[]> {
  const log: string[] = [];
  const teams = await prisma.team.findMany({ select: { id: true } });

  // Compute league-wide scoring average from actual data
  const allCompleted = await prisma.match.findMany({
    where: { status: 'completed', homeScore: { not: null }, awayScore: { not: null } },
  });
  const totalGoals = allCompleted.reduce((s, m) => s + (m.homeScore ?? 0) + (m.awayScore ?? 0), 0);
  const LEAGUE_AVG = allCompleted.length > 0 ? totalGoals / (allCompleted.length * 2) : 1.3;
  log.push(`[TeamStats] League avg goals/team: ${LEAGUE_AVG.toFixed(3)}`);

  let updated = 0;
  for (const { id: teamId } of teams) {
    const completed = await prisma.match.findMany({
      where: {
        status: 'completed',
        homeScore: { not: null },
        awayScore: { not: null },
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
      orderBy: { matchDate: 'desc' },
    });

    let xGF = LEAGUE_AVG;
    let xGA = LEAGUE_AVG;
    let formScore = 0.5;

    if (completed.length > 0) {
      let gf = 0, ga = 0;
      const now = new Date();
      let ws = 0, wt = 0;

      for (let i = 0; i < completed.length; i++) {
        const m = completed[i];
        const isHome = m.homeTeamId === teamId;
        const goals = isHome ? m.homeScore! : m.awayScore!;
        const conc = isHome ? m.awayScore! : m.homeScore!;
        gf += goals;
        ga += conc;
        // Smooth time-decay for ALL matches (not just last 5)
        const days = (now.getTime() - new Date(m.matchDate).getTime()) / 86400000;
        const w = Math.exp(-days / 60);
        ws += goals * w;
        wt += w;
      }

      const n = completed.length;
      const rawXGF = gf / n;
      const rawXGA = ga / n;
      const rawForm = wt > 0 ? ws / wt : 0.5;
      const blend = blendFactor(n);

      xGF = +(rawXGF * blend + LEAGUE_AVG * (1 - blend)).toFixed(3);
      xGA = +(rawXGA * blend + LEAGUE_AVG * (1 - blend)).toFixed(3);
      formScore = Math.min(+(rawForm * blend + 0.5 * (1 - blend)).toFixed(3), 3.0);
    }

    const existing = await prisma.teamStats.findFirst({ where: { teamId } });
    if (existing) {
      await prisma.teamStats.update({
        where: { id: existing.id },
        data: { expectedGoalsFor: xGF, expectedGoalsAgst: xGA, formScore },
      });
    } else {
      await prisma.teamStats.create({
        data: {
          id: `ts_${teamId}`,
          teamId,
          matchDate: new Date(),
          expectedGoalsFor: xGF,
          expectedGoalsAgst: xGA,
          formScore,
        },
      });
    }
    updated++;
  }

  log.push(`[TeamStats] updated ${updated}/${teams.length} teams from real match data (regression to mean)`);
  return log;
}
