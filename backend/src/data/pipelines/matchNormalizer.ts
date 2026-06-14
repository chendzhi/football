/**
 * Match Normalizer — 统一多源数据到标准格式
 *
 * 输入: API-Football / 竞彩 / Kaggle / 手动
 * 输出: StandardMatch
 */

export interface StandardMatch {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number | null;
  awayGoals: number | null;
  date: string;          // ISO 8601
  competition: string;
  season: string;
  status: 'scheduled' | 'completed' | 'live';
  source: string;        // 'api-football' | 'sporttery' | 'kaggle' | 'manual'
}

export interface StandardTeamStats {
  teamId: string;
  teamName: string;
  matches: number;
  goalsFor: number;
  goalsAgainst: number;
  xG?: number;
  xGA?: number;
  form: string;          // "W,D,W,L,W"
  formScore: number;     // 0.0–1.0
  elo?: number;
}

/**
 * Normalize API-Football match → StandardMatch
 */
export function normalizeApiFootballMatch(raw: any): StandardMatch {
  return {
    id: String(raw.fixture.id),
    homeTeam: raw.teams.home.name,
    awayTeam: raw.teams.away.name,
    homeGoals: raw.goals?.home ?? null,
    awayGoals: raw.goals?.away ?? null,
    date: raw.fixture.date,
    competition: raw.league?.name || 'Unknown',
    season: String(raw.league?.season || ''),
    status: ['FT', 'AET', 'PEN'].includes(raw.fixture.status?.short) ? 'completed' : 'scheduled',
    source: 'api-football',
  };
}

/**
 * Normalize sporttery.cn match → StandardMatch
 */
export function normalizeSportteryMatch(raw: any): StandardMatch {
  return {
    id: raw.matchNumStr || '',
    homeTeam: raw.homeTeamAbbName || raw.homeTeamAllName,
    awayTeam: raw.awayTeamAbbName || raw.awayTeamAllName,
    homeGoals: raw.homeScore ? parseInt(raw.homeScore) : null,
    awayGoals: raw.awayScore ? parseInt(raw.awayScore) : null,
    date: `${raw.matchDate}T${raw.matchTime || '00:00:00'}Z`,
    competition: raw.leagueAbbName || 'World Cup',
    season: '2026',
    status: raw.homeScore !== '' && raw.homeScore !== undefined ? 'completed' : 'scheduled',
    source: 'sporttery',
  };
}

/**
 * Compute form score from recent results string like "W,D,W,L,W"
 */
export function computeFormScore(formStr: string): number {
  if (!formStr) return 0.5;
  const results = formStr.split(',');
  const pts = results.reduce((s: number, r: string) => s + (r.trim().toUpperCase() === 'W' ? 3 : r.trim().toUpperCase() === 'D' ? 1 : 0), 0);
  return results.length > 0 ? pts / (results.length * 3) : 0.5;
}
