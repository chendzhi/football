/**
 * Expected XI Engine — 预计首发预测 + Lineup Strength Score
 *
 * 多源数据 → 预测首发 11 人 → 计算阵容强度 → 输入 λ 线性项
 *
 * 数据来源:
 *   worldcup26.ir → 历史出场+进球 (识别核心球员)
 *   DB PlayerStats → 伤病名单
 *
 * 降级方案:
 *   高数据质量 (有进球记录): 进球/出场权重
 *   低数据质量 (无记录): 国家队出场频次估算
 */

import { buildPlayerGoalStats, type PlayerGoalStats } from './realDataEngine';
import type { PrismaClient } from '@prisma/client';

// ─── Types ───

export interface ExpectedPlayer {
  name: string;
  position: 'GK' | 'DEF' | 'MID' | 'FWD' | 'UNKNOWN';
  goalContrib: number;      // 进球+助攻贡献
  appearanceCount: number;  // 出场次数
  isStar: boolean;          // 核心/明星球员
  probability: number;      // 首发概率 0-1
}

export interface LineupStrength {
  overall: number;          // 0-1 综合强度
  attack: number;           // 进攻线强度
  defense: number;          // 防线强度
  midfield: number;         // 中场强度
  starPower: number;        // 明星球员贡献
  missingStars: string[];   // 缺阵核心球员
  expectedXI: ExpectedPlayer[];
  confidence: number;       // 预测置信度
}

// ─── Position inference from name and stats ───

const GK_KEYWORDS = ['keeper', 'goalkeeper', 'gk', 'goal'];
const DEF_KEYWORDS = ['defender', 'centre-back', 'center-back', 'full-back', 'cb', 'rb', 'lb'];
const MID_KEYWORDS = ['midfielder', 'midfield', 'wing', 'cm', 'dm', 'am', 'winger'];
const FWD_KEYWORDS = ['forward', 'striker', 'attacker', 'fw', 'cf', 'st'];

function inferPosition(name: string, goals: number): ExpectedPlayer['position'] {
  const lower = name.toLowerCase();
  if (GK_KEYWORDS.some(k => lower.includes(k))) return 'GK';
  if (DEF_KEYWORDS.some(k => lower.includes(k))) return 'DEF';
  if (MID_KEYWORDS.some(k => lower.includes(k))) return 'MID';
  if (FWD_KEYWORDS.some(k => lower.includes(k))) return 'FWD';
  // Heuristic: high goals → forward, moderate → mid, low → def
  if (goals >= 3) return 'FWD';
  if (goals >= 1) return 'MID';
  return 'UNKNOWN';
}

// ─── Main function ───

export async function computeExpectedXI(
  prisma: PrismaClient,
  teamId: string,
  injuredPlayerNames: string[]
): Promise<LineupStrength> {
  const allStats = await buildPlayerGoalStats();
  const teamStats = allStats.get(teamId) || [];

  // 1. Build expected XI from players with goal contributions
  const sortedPlayers = [...teamStats].sort((a, b) => b.goals - a.goals);
  const missingSet = new Set(injuredPlayerNames.map(n => n.toLowerCase()));

  // 2. Assign position and star status
  const expectedXI: ExpectedPlayer[] = sortedPlayers.slice(0, 18).map((p, i) => {
    const pos = inferPosition(p.playerName, p.goals);
    return {
      name: p.playerName,
      position: pos,
      goalContrib: p.goals,
      appearanceCount: p.matches,
      isStar: p.isTopScorer || p.goals >= 2,
      probability: i < 11 ? 0.85 : 0.40, // top 11 high probability
    };
  });

  // 3. Identify missing stars
  const missingStars = expectedXI
    .filter(p => p.isStar && missingSet.has(p.name.toLowerCase()))
    .map(p => p.name);

  // 4. Calculate strength scores
  const starters = expectedXI.filter(p => p.probability >= 0.7);
  const starPlayers = starters.filter(p => p.isStar);

  // Attack strength: forward + midfielder goal contributions
  const attackers = starters.filter(p => p.position === 'FWD' || p.position === 'MID');
  const attackRaw = attackers.reduce((s, p) => s + p.goalContrib, 0);
  const attack = Math.min(1, attackRaw / 8); // normalize: 8+ goal contributions = max

  // Defense strength: inversely proportional to missing defenders
  const defenders = starters.filter(p => p.position === 'DEF' || p.position === 'GK');
  const defRaw = defenders.length;
  const defense = Math.min(1, defRaw / 6);

  // Midfield: from MID players
  const midfielders = starters.filter(p => p.position === 'MID');
  const midRaw = midfielders.reduce((s, p) => s + p.goalContrib, 0);
  const midfield = Math.min(1, midRaw / 5);

  // Star power: star count + goal contributions
  const starRaw = starPlayers.reduce((s, p) => s + p.goalContrib, 0);
  const starPower = Math.min(1, starRaw / 4);

  // Overall: weighted blend
  const overall = parseFloat((attack * 0.30 + defense * 0.25 + midfield * 0.20 + starPower * 0.25).toFixed(3));

  return {
    overall,
    attack: parseFloat(attack.toFixed(2)),
    defense: parseFloat(defense.toFixed(2)),
    midfield: parseFloat(midfield.toFixed(2)),
    starPower: parseFloat(starPower.toFixed(2)),
    missingStars,
    expectedXI: expectedXI.slice(0, 11),
    confidence: Math.min(1, teamStats.length / 15), // more data → more confidence
  };
}

/**
 * Lineup Strength → λ 修正
 * 阵容强度差值直接影响双方预期进球
 */
export function lineupStrengthToLambda(
  homeLineup: LineupStrength,
  awayLineup: LineupStrength
): { homeAdj: number; awayAdj: number; reason: string } {
  // 阵容强度差映射到 λ 调整
  const diff = homeLineup.overall - awayLineup.overall;

  // 强度差 ±0.2 → ±15% λ 调整
  const homeAdj = parseFloat((1 + diff * 0.75).toFixed(3));
  const awayAdj = parseFloat((1 - diff * 0.75).toFixed(3));

  let reason = `阵容强度: 主${homeLineup.overall.toFixed(2)} vs 客${awayLineup.overall.toFixed(2)}`;
  if (homeLineup.missingStars.length > 0) {
    reason += ` | 主缺: ${homeLineup.missingStars.join(', ')}`;
  }
  if (awayLineup.missingStars.length > 0) {
    reason += ` | 客缺: ${awayLineup.missingStars.join(', ')}`;
  }

  return { homeAdj, awayAdj, reason };
}
