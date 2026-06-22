/**
 * ESPN Stats Engine — 全量球员+球队统计
 *
 * ESPN Core API (完全免费, 无需API Key):
 *   .../events/{eventId}/competitions/{compId}/competitors/{teamId}/statistics/0
 *
 * 提供 145 项真实统计:
 *   进攻: 射门/射正/xG/传球/控球率/角球/禁区触球
 *   防守: 抢断/拦截/封堵/解围/PPDA
 *   门将: 扑救/扑救率/被射正/预期失球/阻止进球
 *   综合: 对抗胜率/争顶/传球成功率
 */

import axios from 'axios';

const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues/fifa.world';

// ─── Types ───

export interface TeamMatchStats {
  // 进攻
  totalShots: number;
  shotsOnTarget: number;
  shotAccuracy: number;
  expectedGoals: number;
  expectedGoalsOpenPlay: number;
  expectedGoalsSetPlay: number;
  possessionPct: number;
  totalPasses: number;
  accuratePasses: number;
  passAccuracy: number;
  totalCrosses: number;
  accurateCrosses: number;
  cornersWon: number;
  finalThirdEntries: number;
  penAreaEntries: number;
  touchesInOppBox: number;
  attemptsInsideBox: number;
  attemptsOutsideBox: number;
  offsides: number;
  goalAssists: number;
  shotAssists: number;

  // 防守
  totalTackles: number;
  tacklesWon: number;
  tacklePct: number;
  interceptions: number;
  clearances: number;
  blockedShots: number;
  ballRecovery: number;
  ppda: number;  // Passes Per Defensive Action
  foulsCommitted: number;
  foulsSuffered: number;
  yellowCards: number;
  redCards: number;

  // 对抗
  duelsWon: number;
  duelsLost: number;
  duelWinPct: number;
  aerialsWon: number;
  aerialsLost: number;
  groundDuelsWon: number;

  // 门将
  saves: number;
  savePct: number;
  shotsFaced: number;
  shotsOnGoalAgainst: number;
  goalsConceded: number;
  cleanSheet: number;
  expectedGoalsConceded: number;
  goalsPrevented: number;
  crossesClaimed: number;
  punches: number;

  // 综合
  touches: number;
  accurateLongBalls: number;
  dispossessed: number;
}

// ─── Parsing ───

function parseStats(data: any): TeamMatchStats {
  const cats = data?.splits?.categories || [];
  const all: Record<string, number> = {};

  for (const cat of cats) {
    for (const stat of cat.stats || []) {
      all[stat.name] = parseFloat(stat.value) || 0;
    }
  }

  return {
    totalShots: all.totalShots || 0,
    shotsOnTarget: all.shotsOnTarget || 0,
    shotAccuracy: all.shotPct || all.onTargetPct || 0,
    expectedGoals: all.expectedGoals || 0,
    expectedGoalsOpenPlay: all.expectedGoalsOpenPlay || 0,
    expectedGoalsSetPlay: all.expectedGoalsSetPlay || 0,
    possessionPct: all.possessionPct || 0,
    totalPasses: all.totalPasses || 0,
    accuratePasses: all.accuratePasses || 0,
    passAccuracy: all.passPct || 0,
    totalCrosses: all.totalCrosses || 0,
    accurateCrosses: all.accurateCrosses || 0,
    cornersWon: all.wonCorners || 0,
    finalThirdEntries: all.finalThirdEntries || 0,
    penAreaEntries: all.penAreaEntries || 0,
    touchesInOppBox: all.touchesInOppBox || 0,
    attemptsInsideBox: all.attemptsIbox || 0,
    attemptsOutsideBox: all.attemptsObox || 0,
    offsides: all.offsides || 0,
    goalAssists: all.goalAssists || 0,
    shotAssists: all.shotAssists || 0,

    totalTackles: all.totalTackles || 0,
    tacklesWon: all.effectiveTackles || 0,
    tacklePct: all.tacklePct || 0,
    interceptions: all.interceptions || 0,
    clearances: all.totalClearance || 0,
    blockedShots: all.blockedShots || 0,
    ballRecovery: all.ballRecovery || 0,
    ppda: all.ppda || 0,
    foulsCommitted: all.foulsCommitted || 0,
    foulsSuffered: all.foulsSuffered || 0,
    yellowCards: all.yellowCards || 0,
    redCards: all.redCards || 0,

    duelsWon: all.duelsWon || 0,
    duelsLost: all.duelsLost || 0,
    duelWinPct: all.duelWinPct || 0,
    aerialsWon: all.aerialsWon || 0,
    aerialsLost: all.aerialsLost || 0,
    groundDuelsWon: all.groundDuelsWon || 0,

    saves: all.saves || 0,
    savePct: all.savePct || 0,
    shotsFaced: all.shotsFaced || 0,
    shotsOnGoalAgainst: all.shotsOnGoalAgainst || 0,
    goalsConceded: all.goalsConceded || 0,
    cleanSheet: all.cleanSheet || 0,
    expectedGoalsConceded: all.expectedGoalsConceded || 0,
    goalsPrevented: all.goalsPrevented || 0,
    crossesClaimed: all.crossesCaught || 0,
    punches: all.punches || 0,

    touches: all.touches || 0,
    accurateLongBalls: all.accurateLongBalls || 0,
    dispossessed: all.dispossessed || 0,
  };
}

// ─── Fetch ───

const statsCache = new Map<string, { data: TeamMatchStats; time: number }>();

export async function fetchTeamMatchStats(
  eventId: string,
  competitionId: string,
  teamId: string
): Promise<TeamMatchStats | null> {
  const cacheKey = `${eventId}_${teamId}`;
  const cached = statsCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 300000) return cached.data;

  try {
    const url = `${ESPN_CORE}/events/${eventId}/competitions/${competitionId}/competitors/${teamId}/statistics/0?lang=en&region=us`;
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'FootballPrediction/3.0' },
    });
    const stats = parseStats(data);
    statsCache.set(cacheKey, { data: stats, time: Date.now() });
    return stats;
  } catch (e: any) {
    console.log('[ESPN Stats] fetch failed:', e.message);
    return null;
  }
}

/**
 * 统计 → λ 修正
 *
 * 利用真实比赛统计微调预期进球:
 *   - 传球成功率低 → 进攻效率差 → λ 下调
 *   - 被射正多 + 扑救率低 → 防守弱 → 对手 λ 上调
 *   - 对抗胜率低 → 中场失控 → 双向下调
 */
export function statsToLambdaAdjustment(
  stats: TeamMatchStats,
  isHome: boolean
): { attackAdj: number; defenseAdj: number; gkAdj: number; details: string[] } {
  const details: string[] = [];
  let attackAdj = 1.0;
  let defenseAdj = 1.0;
  let gkAdj = 1.0;

  // 射门转化: 高射门低射正 → 浪射 → 进攻扣分
  if (stats.totalShots > 5 && stats.shotAccuracy < 0.2) {
    attackAdj *= 0.92;
    details.push(`浪射(射正率${(stats.shotAccuracy*100).toFixed(0)}%) → 进攻 -8%`);
  }

  // xG 低 → 机会质量差
  if (stats.expectedGoals < 0.3 && stats.possessionPct > 30) {
    attackAdj *= 0.90;
    details.push(`低xG(${stats.expectedGoals.toFixed(2)}) → 进攻 -10%`);
  }

  // 传球成功率低 → 组织差
  if (stats.totalPasses > 100 && stats.passAccuracy < 0.65) {
    attackAdj *= 0.93;
    details.push(`传球差(成功率${(stats.passAccuracy*100).toFixed(0)}%) → 进攻 -7%`);
  }

  // 防守: PPDA 高 → 压迫弱 → 对手容易组织
  if (stats.ppda > 15 && stats.totalPasses > 100) {
    defenseAdj *= 1.06; // opponent gets boost
    details.push(`压迫弱(PPDA=${stats.ppda.toFixed(1)}) → 对手进攻 +6%`);
  }

  // 门将: 扑救率低 → 射正即进球
  if (stats.shotsFaced > 3 && stats.savePct < 0.3) {
    gkAdj *= 1.10;
    details.push(`门将扑救率低(${(stats.savePct*100).toFixed(0)}%) → 对手射门转化 +10%`);
  }

  // 门将: goalsPrevented 负 → 门将实际丢球多于预期
  if (stats.goalsPrevented < -0.5) {
    gkAdj *= 1.08;
    details.push(`门将低于预期(阻止${stats.goalsPrevented.toFixed(1)}球) → 对手 +8%`);
  }

  // 对抗胜率低 → 身体劣势
  if (stats.duelsWon + stats.duelsLost > 20 && stats.duelWinPct < 0.4) {
    attackAdj *= 0.94;
    defenseAdj *= 1.04;
    details.push(`对抗劣势(胜率${(stats.duelWinPct*100).toFixed(0)}%)`);
  }

  return {
    attackAdj: parseFloat(attackAdj.toFixed(3)),
    defenseAdj: parseFloat(defenseAdj.toFixed(3)),
    gkAdj: parseFloat(gkAdj.toFixed(3)),
    details,
  };
}
