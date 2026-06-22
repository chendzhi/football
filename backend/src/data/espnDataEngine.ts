/**
 * ESPN Data Engine — 全量真实赛事数据爬取
 *
 * ESPN API 完全免费, 无需 API Key:
 *   /scoreboard          → 所有比赛 + 比分 + 状态
 *   /summary?event=ID    → 阵容/事件/裁判/赔率/H2H/近期战绩/球员统计
 *
 * 提供:
 *   - 首发阵容 + 阵型 + 球员位置
 *   - 红黄牌事件
 *   - 裁判真实姓名
 *   - 多机构赔率
 *   - H2H 细化
 *   - 门将扑救数据
 *   - 近期比赛结果
 */

import axios from 'axios';
import { fetchTeamMatchStats, type TeamMatchStats } from './espnStatsEngine';

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world';

// ─── Types ───

export interface ESPNPlayer {
  displayName: string;
  position: string;       // 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Forward'
  jersey: string;
  isStarter: boolean;
  stats: ESPNPlayerStats;
}

export interface ESPNPlayerStats {
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  saves: number;
  yellowCards: number;
  redCards: number;
  foulsCommitted: number;
  foulsSuffered: number;
  offsides: number;
  minutesPlayed: number;
}

export interface ESPNMatchEvent {
  minute: number;
  type: string;           // 'goal' | 'yellow_card' | 'red_card' | 'substitution' | 'penalty'
  team: string;
  player: string;
  detail: string;
}

export interface ESPNLineup {
  teamId: string;
  teamName: string;
  formation: string;
  starters: ESPNPlayer[];
  substitutes: ESPNPlayer[];
  goalkeeper: ESPNPlayer | null;
}

export interface ESPNReferee {
  name: string;
  role: string;           // 'Referee' | 'Assistant Referee' | 'VAR'
}

export interface ESGameInfo {
  venue: string;
  city: string;
  attendance: number;
  referee: ESPNReferee | null;
  temperature: string;
  weather: string;
}

export interface ESPNMatchData {
  rosters: ESPNLineup[];
  events: ESPNMatchEvent[];
  gameInfo: ESGameInfo;
  headToHead: Array<{ date: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }>;
  lastFiveHome: Array<{ opponent: string; result: string; score: string }>;
  lastFiveAway: Array<{ opponent: string; result: string; score: string }>;
  homeStats: TeamMatchStats | null;
  awayStats: TeamMatchStats | null;
}

// ─── Team name → our ID mapping ───

const TEAM_NAME_MAP: Record<string, string> = {
  'Mexico': 'mex', 'South Africa': 'rsa', 'South Korea': 'kor', 'Czechia': 'cze', 'Czech Republic': 'cze',
  'Canada': 'can', 'Bosnia and Herzegovina': 'bih', 'Qatar': 'qat', 'Switzerland': 'sui',
  'Brazil': 'bra', 'Morocco': 'mar', 'Haiti': 'hai', 'Scotland': 'sco',
  'United States': 'usa', 'Paraguay': 'par', 'Australia': 'aus', 'Turkey': 'tur',
  'Germany': 'ger', 'Curaçao': 'cuw', "Côte d'Ivoire": 'civ', 'Ivory Coast': 'civ', 'Ecuador': 'ecu',
  'Netherlands': 'ned', 'Japan': 'jpn', 'Sweden': 'swe', 'Tunisia': 'tun',
  'Spain': 'esp', 'Cape Verde': 'cpv', 'Saudi Arabia': 'ksa', 'Uruguay': 'uru',
  'Belgium': 'bel', 'Egypt': 'egy', 'Iran': 'irn', 'New Zealand': 'nzl',
  'France': 'fra', 'Senegal': 'sen', 'Iraq': 'irq', 'Norway': 'nor',
  'Argentina': 'arg', 'Algeria': 'alg', 'Austria': 'aut', 'Jordan': 'jor',
  'Portugal': 'por', 'Colombia': 'col', 'DR Congo': 'cod', 'Uzbekistan': 'uzb',
  'England': 'eng', 'Croatia': 'cro', 'Ghana': 'gha', 'Panama': 'pan',
};

// ─── Cache ───
const cache = new Map<string, { data: any; time: number }>();
const CACHE_TTL = 300000; // 5 min

async function cachedFetch(url: string): Promise<any> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.data;

  const { data } = await axios.get(url, {
    timeout: 10000,
    headers: { 'User-Agent': 'FootballPrediction/3.0' },
  });
  cache.set(url, { data, time: Date.now() });
  return data;
}

// ─── 1. Get match ID from our matchId → ESPN event ID ───

const matchToESPNCache = new Map<string, string>();

export async function findESPNEventId(
  homeTeamName: string,
  awayTeamName: string,
  matchDate: Date
): Promise<string | null> {
  const key = `${homeTeamName}_${awayTeamName}_${matchDate.toISOString().slice(0, 10)}`;
  if (matchToESPNCache.has(key)) return matchToESPNCache.get(key)!;

  try {
    const data = await cachedFetch(`${ESPN_BASE}/scoreboard`);
    const events = data.events || [];
    const targetDate = matchDate.toISOString().slice(0, 10);

    for (const ev of events) {
      const comps = ev.competitions?.[0];
      if (!comps) continue;
      const teams = comps.competitors || [];
      const homeTeam = teams.find((t: any) => t.homeAway === 'home')?.team?.displayName || '';
      const awayTeam = teams.find((t: any) => t.homeAway === 'away')?.team?.displayName || '';
      const evDate = ev.date?.slice(0, 10);

      const homeMatch = homeTeam.toLowerCase().includes(homeTeamName.toLowerCase()) ||
        homeTeamName.toLowerCase().includes(homeTeam.toLowerCase());
      const awayMatch = awayTeam.toLowerCase().includes(awayTeamName.toLowerCase()) ||
        awayTeamName.toLowerCase().includes(awayTeam.toLowerCase());

      if (homeMatch && awayMatch && evDate === targetDate) {
        matchToESPNCache.set(key, ev.id);
        return ev.id;
      }
    }
  } catch (e: any) {
    console.log('[ESPN] scoreboard fetch failed:', e.message);
  }
  return null;
}

// ─── 2. Parse roster → lineup ───

function parseRoster(rosterData: any): ESPNLineup | null {
  if (!rosterData?.roster) return null;

  const teamName = rosterData.team?.displayName || '';
  const teamId = TEAM_NAME_MAP[teamName] || teamName.toLowerCase().slice(0, 3);
  const formation = rosterData.formation?.displayName || '4-4-2';

  const players: ESPNPlayer[] = [];
  let goalkeeper: ESPNPlayer | null = null;

  for (const p of rosterData.roster) {
    const athlete = p.athlete || {};
    const stats = p.stats?.[0] || {};
    const pos = p.position?.name || 'Unknown';

    const player: ESPNPlayer = {
      displayName: athlete.displayName || '',
      position: pos,
      jersey: p.jersey || '',
      isStarter: p.starter || false,
      stats: {
        goals: parseInt(stats.goals) || 0,
        assists: parseInt(stats.assists) || 0,
        shots: parseInt(stats.shots) || 0,
        shotsOnTarget: parseInt(stats.shotsOnTarget) || 0,
        saves: parseInt(stats.saves) || 0,
        yellowCards: parseInt(stats.yellowCards) || 0,
        redCards: parseInt(stats.redCards) || 0,
        foulsCommitted: parseInt(stats.foulsCommitted) || 0,
        foulsSuffered: parseInt(stats.foulsSuffered) || 0,
        offsides: parseInt(stats.offsides) || 0,
        minutesPlayed: parseInt(stats.minutesPlayed) || 0,
      },
    };

    if (pos === 'Goalkeeper' && p.starter) goalkeeper = player;
    players.push(player);
  }

  const starters = players.filter(p => p.isStarter);
  const subs = players.filter(p => !p.isStarter);

  return { teamId: teamId.toLowerCase(), teamName, formation, starters, substitutes: subs, goalkeeper };
}

// ─── 3. Parse key events → cards, goals ───

function parseKeyEvents(events: any[]): ESPNMatchEvent[] {
  if (!events) return [];
  return events.map((e: any) => ({
    minute: e.clock?.displayValue || e.clock?.value || 0,
    type: e.type?.text?.toLowerCase().includes('yellow') ? 'yellow_card'
      : e.type?.text?.toLowerCase().includes('red') ? 'red_card'
      : e.type?.text?.toLowerCase().includes('goal') || e.type?.text?.toLowerCase().includes('penalty') ? 'goal'
      : e.type?.text?.toLowerCase().includes('sub') ? 'substitution'
      : e.type?.text?.toLowerCase().includes('var') ? 'var_review'
      : 'other',
    team: e.team?.displayName || '',
    player: e.participants?.[0]?.displayName || '',
    detail: e.text || e.type?.text || '',
  })).filter(e => e.type !== 'other');
}

// ─── 4. Parse game info ───

function parseGameInfo(info: any): ESGameInfo {
  return {
    venue: info?.venue?.fullName || '',
    city: info?.venue?.address?.city || '',
    attendance: info?.attendance || 0,
    referee: info?.officials?.find((o: any) => o.position?.name === 'Referee')
      ? { name: info.officials.find((o: any) => o.position?.name === 'Referee').displayName, role: 'Referee' }
      : null,
    temperature: info?.weather?.temperature || '',
    weather: info?.weather?.displayValue || '',
  };
}

// ─── 5. Parse H2H ───

function parseH2H(games: any[]): Array<{ date: string; homeTeam: string; awayTeam: string; homeScore: number; awayScore: number }> {
  if (!games) return [];
  return games.map((g: any) => {
    const teams = g.competitions?.[0]?.competitors || [];
    const home = teams.find((t: any) => t.homeAway === 'home');
    const away = teams.find((t: any) => t.homeAway === 'away');
    return {
      date: g.date?.slice(0, 10) || '',
      homeTeam: home?.team?.displayName || '',
      awayTeam: away?.team?.displayName || '',
      homeScore: parseInt(home?.score) || 0,
      awayScore: parseInt(away?.score) || 0,
    };
  });
}

// ─── 6. Main function: collect all ESPN data ───

export async function collectESPNData(
  homeTeamName: string,
  awayTeamName: string,
  matchDate: Date
): Promise<ESPNMatchData | null> {
  const eventId = await findESPNEventId(homeTeamName, awayTeamName, matchDate);
  if (!eventId) {
    console.log(`[ESPN] No match found for ${homeTeamName} vs ${awayTeamName}`);
    return null;
  }

  try {
    const data = await cachedFetch(`${ESPN_BASE}/summary?event=${eventId}`);

    const rosters: ESPNLineup[] = [];
    if (data.rosters) {
      for (const r of data.rosters) {
        const lineup = parseRoster(r);
        if (lineup) rosters.push(lineup);
      }
    }

    const events = parseKeyEvents(data.keyEvents || []);
    const gameInfo = parseGameInfo(data.gameInfo);
    const headToHead = parseH2H(data.headToHeadGames || []);
    const lastFiveHome = (data.lastFiveGames || []).map((g: any) => {
      const teams = g.competitions?.[0]?.competitors || [];
      const opp = teams.find((t: any) => t.homeAway === 'away')?.team?.displayName || '';
      const hScore = parseInt(teams.find((t: any) => t.homeAway === 'home')?.score) || 0;
      const aScore = parseInt(teams.find((t: any) => t.homeAway === 'away')?.score) || 0;
      return { opponent: opp, result: hScore > aScore ? 'W' : hScore < aScore ? 'L' : 'D', score: `${hScore}-${aScore}` };
    });

    // Fetch team stats from ESPN Core API
    let homeStats: TeamMatchStats | null = null;
    let awayStats: TeamMatchStats | null = null;
    try {
      const comps = data.header?.competitions || [];
      const compId = comps[0]?.id || eventId;
      const homeTeamId = comps[0]?.competitors?.[0]?.id || '';
      const awayTeamId = comps[0]?.competitors?.[1]?.id || '';
      if (homeTeamId && awayTeamId) {
        [homeStats, awayStats] = await Promise.all([
          fetchTeamMatchStats(eventId, compId, homeTeamId).catch(() => null),
          fetchTeamMatchStats(eventId, compId, awayTeamId).catch(() => null),
        ]);
      }
    } catch {}

    return { rosters, events, gameInfo, headToHead, lastFiveHome, lastFiveAway: [], homeStats, awayStats };
  } catch (e: any) {
    console.log('[ESPN] summary fetch failed:', e.message);
    return null;
  }
}

// ─── 7. Extract specific features ───

export interface ExtractedFeatures {
  // 阵容
  homeFormation: string;
  awayFormation: string;
  homeGoalkeeper: string;
  awayGoalkeeper: string;
  homeGoalKeeperSaves: number;
  awayGoalKeeperSaves: number;

  // 纪律
  homeYellowCards: number;
  awayYellowCards: number;
  homeRedCards: number;
  awayRedCards: number;

  // 球员质量
  homeGoalContributions: number;  // 首发球员总进球
  awayGoalContributions: number;

  // 裁判
  refereeName: string;

  // 场馆
  venue: string;
  attendance: number;
}

export function extractKeyFeatures(espnData: ESPNMatchData): ExtractedFeatures {
  const home = espnData.rosters[0];
  const away = espnData.rosters[1];

  const homeCards = espnData.events.filter(e => e.team === home?.teamName && (e.type === 'yellow_card' || e.type === 'red_card'));
  const awayCards = espnData.events.filter(e => e.team === away?.teamName && (e.type === 'yellow_card' || e.type === 'red_card'));

  return {
    homeFormation: home?.formation || '4-4-2',
    awayFormation: away?.formation || '4-4-2',
    homeGoalkeeper: home?.goalkeeper?.displayName || 'Unknown',
    awayGoalkeeper: away?.goalkeeper?.displayName || 'Unknown',
    homeGoalKeeperSaves: home?.goalkeeper?.stats?.saves || 0,
    awayGoalKeeperSaves: away?.goalkeeper?.stats?.saves || 0,
    homeYellowCards: homeCards.filter(e => e.type === 'yellow_card').length,
    awayYellowCards: awayCards.filter(e => e.type === 'yellow_card').length,
    homeRedCards: homeCards.filter(e => e.type === 'red_card').length,
    awayRedCards: awayCards.filter(e => e.type === 'red_card').length,
    homeGoalContributions: (home?.starters || []).reduce((s, p) => s + p.stats.goals + p.stats.assists, 0),
    awayGoalContributions: (away?.starters || []).reduce((s, p) => s + p.stats.goals + p.stats.assists, 0),
    refereeName: espnData.gameInfo.referee?.name || 'Unknown',
    venue: espnData.gameInfo.venue,
    attendance: espnData.gameInfo.attendance,
  };
}

// ─── 8. Lineup Strength V2 (with real positions) ───

export function realLineupStrength(lineup: ESPNLineup): {
  overall: number; attack: number; defense: number; gkQuality: number;
} {
  if (!lineup?.starters?.length) return { overall: 0.5, attack: 0.5, defense: 0.5, gkQuality: 0.5 };

  const starters = lineup.starters;
  const fwds = starters.filter(p => p.position === 'Forward');
  const mids = starters.filter(p => p.position === 'Midfielder');
  const defs = starters.filter(p => p.position === 'Defender');
  const gk = lineup.goalkeeper;

  // Attack: forward + midfielder goal contributions
  const attackContribs = [...fwds, ...mids].reduce((s, p) => s + p.stats.goals + p.stats.assists * 0.5, 0);
  const attack = Math.min(1, 0.3 + attackContribs / 6);

  // Defense: defender count + clean sheet history
  const defense = Math.min(1, 0.3 + defs.length / 5 * 0.7);

  // GK quality: saves per match rating
  const gkQuality = gk ? Math.min(1, 0.2 + (gk.stats.saves / 6) * 0.8) : 0.5;

  const overall = parseFloat((attack * 0.35 + defense * 0.30 + gkQuality * 0.35).toFixed(3));

  return { overall, attack: parseFloat(attack.toFixed(2)), defense: parseFloat(defense.toFixed(2)), gkQuality: parseFloat(gkQuality.toFixed(2)) };
}
