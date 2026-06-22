/**
 * Match Data Engine — 全量真实赛事数据
 *
 * 数据来源:
 *   - 已有 DB: rolling stats, H2H, group standings, schedule
 *   - Open-Meteo API (free): weather
 *   - API-Football free tier: lineups, cards, shots, referee
 *   - Static DB: team coordinates, stadium data, referee profiles
 *
 * 全部在预测时实时计算/爬取
 */

import axios from 'axios';
import type { PrismaClient } from '@prisma/client';

// ─── Team Home Country Coordinates ───
const TEAM_COORDS: Record<string, { lat: number; lon: number; name: string }> = {
  'mex': { lat: 19.43, lon: -99.13, name: 'Mexico' },
  'usa': { lat: 38.90, lon: -77.02, name: 'United States' },
  'can': { lat: 45.42, lon: -75.70, name: 'Canada' },
  'bra': { lat: -15.78, lon: -47.93, name: 'Brazil' },
  'arg': { lat: -34.60, lon: -58.38, name: 'Argentina' },
  'uru': { lat: -34.88, lon: -56.16, name: 'Uruguay' },
  'par': { lat: -25.28, lon: -57.63, name: 'Paraguay' },
  'ecu': { lat: -0.18, lon: -78.47, name: 'Ecuador' },
  'col': { lat: 4.71, lon: -74.07, name: 'Colombia' },
  'chi': { lat: -33.45, lon: -70.65, name: 'Chile' },
  'eng': { lat: 51.51, lon: -0.13, name: 'England' },
  'fra': { lat: 48.86, lon: 2.35, name: 'France' },
  'ger': { lat: 52.52, lon: 13.40, name: 'Germany' },
  'esp': { lat: 40.42, lon: -3.70, name: 'Spain' },
  'por': { lat: 38.72, lon: -9.14, name: 'Portugal' },
  'ned': { lat: 52.37, lon: 4.90, name: 'Netherlands' },
  'bel': { lat: 50.85, lon: 4.35, name: 'Belgium' },
  'sui': { lat: 46.95, lon: 7.45, name: 'Switzerland' },
  'cro': { lat: 45.81, lon: 15.98, name: 'Croatia' },
  'ita': { lat: 41.90, lon: 12.50, name: 'Italy' },
  'swe': { lat: 59.33, lon: 18.07, name: 'Sweden' },
  'nor': { lat: 59.91, lon: 10.75, name: 'Norway' },
  'den': { lat: 55.68, lon: 12.57, name: 'Denmark' },
  'aut': { lat: 48.21, lon: 16.37, name: 'Austria' },
  'cze': { lat: 50.08, lon: 14.44, name: 'Czechia' },
  'sco': { lat: 55.95, lon: -3.19, name: 'Scotland' },
  'tur': { lat: 39.93, lon: 32.86, name: 'Turkey' },
  'jpn': { lat: 35.68, lon: 139.77, name: 'Japan' },
  'kor': { lat: 37.57, lon: 126.98, name: 'South Korea' },
  'aus': { lat: -35.28, lon: 149.13, name: 'Australia' },
  'irn': { lat: 35.72, lon: 51.33, name: 'Iran' },
  'ksa': { lat: 24.71, lon: 46.67, name: 'Saudi Arabia' },
  'qat': { lat: 25.28, lon: 51.53, name: 'Qatar' },
  'egy': { lat: 30.04, lon: 31.24, name: 'Egypt' },
  'mar': { lat: 34.02, lon: -6.84, name: 'Morocco' },
  'alg': { lat: 36.75, lon: 3.04, name: 'Algeria' },
  'tun': { lat: 36.82, lon: 10.18, name: 'Tunisia' },
  'sen': { lat: 14.69, lon: -17.44, name: 'Senegal' },
  'civ': { lat: 5.36, lon: -4.03, name: 'Ivory Coast' },
  'gha': { lat: 5.60, lon: -0.19, name: 'Ghana' },
  'nga': { lat: 9.06, lon: 7.50, name: 'Nigeria' },
  'cmr': { lat: 3.87, lon: 11.52, name: 'Cameroon' },
  'rsa': { lat: -25.75, lon: 28.19, name: 'South Africa' },
  'cod': { lat: -4.32, lon: 15.31, name: 'DR Congo' },
  'nzl': { lat: -41.29, lon: 174.78, name: 'New Zealand' },
  'hai': { lat: 18.54, lon: -72.34, name: 'Haiti' },
  'cpv': { lat: 14.92, lon: -23.51, name: 'Cape Verde' },
  'bih': { lat: 43.86, lon: 18.41, name: 'Bosnia' },
  'jor': { lat: 31.95, lon: 35.93, name: 'Jordan' },
  'uzb': { lat: 41.30, lon: 69.26, name: 'Uzbekistan' },
  'pan': { lat: 9.01, lon: -79.52, name: 'Panama' },
  'irq': { lat: 33.32, lon: 44.39, name: 'Iraq' },
  'cuw': { lat: 12.17, lon: -68.99, name: 'Curaçao' },
};

// ─── Venue Data (World Cup 2026 stadiums) ───
const VENUES: Record<string, { name: string; city: string; lat: number; lon: number; altitude: number; capacity: number; pitchSize: string; surface: string }> = {
  'mex_azteca':    { name: 'Estadio Azteca', city: 'Mexico City', lat: 19.30, lon: -99.15, altitude: 2250, capacity: 87523, pitchSize: '105x68', surface: 'grass' },
  'usa_metlife':   { name: 'MetLife Stadium', city: 'East Rutherford', lat: 40.81, lon: -74.07, altitude: 3, capacity: 82500, pitchSize: '105x68', surface: 'artificial' },
  'usa_sofi':      { name: 'SoFi Stadium', city: 'Inglewood', lat: 33.95, lon: -118.34, altitude: 38, capacity: 70240, pitchSize: '105x68', surface: 'artificial' },
  'usa_att':       { name: 'AT&T Stadium', city: 'Arlington', lat: 32.75, lon: -97.08, altitude: 183, capacity: 80000, pitchSize: '105x68', surface: 'artificial' },
  'can_bmo':       { name: 'BMO Field', city: 'Toronto', lat: 43.63, lon: -79.42, altitude: 76, capacity: 45000, pitchSize: '105x68', surface: 'grass' },
  'monterrey':     { name: 'Estadio BBVA', city: 'Monterrey', lat: 25.67, lon: -100.27, altitude: 540, capacity: 53500, pitchSize: '105x68', surface: 'grass' },
  '_default':      { name: 'Neutral Venue', city: 'Monterrey', lat: 25.76, lon: -100.31, altitude: 540, capacity: 50000, pitchSize: '105x68', surface: 'grass' },
};

// ─── Referee Database ───
interface RefereeProfile {
  name: string;
  avgFouls: number;      // per match
  avgYellows: number;
  avgReds: number;
  avgPenalties: number;
  strictness: number;     // 0-1, higher = stricter
}

const REFEREE_DB: Record<string, RefereeProfile> = {
  '_default': { name: 'Unknown', avgFouls: 26, avgYellows: 4.2, avgReds: 0.25, avgPenalties: 0.30, strictness: 0.5 },
  'marciniak': { name: 'Szymon Marciniak', avgFouls: 28, avgYellows: 4.8, avgReds: 0.22, avgPenalties: 0.35, strictness: 0.65 },
  'taylor': { name: 'Anthony Taylor', avgFouls: 24, avgYellows: 4.0, avgReds: 0.18, avgPenalties: 0.28, strictness: 0.55 },
  'mateu': { name: 'Antonio Mateu Lahoz', avgFouls: 30, avgYellows: 5.5, avgReds: 0.35, avgPenalties: 0.40, strictness: 0.80 },
  'oliver': { name: 'Michael Oliver', avgFouls: 22, avgYellows: 3.5, avgReds: 0.15, avgPenalties: 0.22, strictness: 0.45 },
  'turpin': { name: 'Clément Turpin', avgFouls: 26, avgYellows: 4.3, avgReds: 0.20, avgPenalties: 0.30, strictness: 0.55 },
  'orsato': { name: 'Daniele Orsato', avgFouls: 27, avgYellows: 4.5, avgReds: 0.24, avgPenalties: 0.32, strictness: 0.60 },
};

// ─── Interfaces ───

export interface TravelData {
  homeDistanceKm: number;
  awayDistanceKm: number;
  homeJetLag: number;       // hours
  awayJetLag: number;
  homeTravelFatigue: number; // 0-1
  awayTravelFatigue: number;
}

export interface TournamentContext {
  stageWeight: number;       // 1.0 (group) → 1.5 (final)
  isKnockout: boolean;
  isGroupMatch3: boolean;    // 小组第三轮
  collusionPossible: boolean; // 默契球可能
  collusionDrawProb: number;  // 默契平局概率上调
}

export interface ScheduleDensity {
  homeDaysSinceLast: number;
  awayDaysSinceLast: number;
  homeMatch3in7: boolean;    // 7天3赛
  awayMatch3in7: boolean;
  homeFatigueScore: number;  // 0-1
  awayFatigueScore: number;
}

export interface RefereeImpact {
  name: string;
  strictness: number;
  expectedCards: number;
  expectedPenalties: number;
  goalImpact: number;        // >1 = more goals (lenient), <1 = fewer goals (strict)
}

export interface CardSuspension {
  homeMissing: string[];    // suspended player descriptions
  awayMissing: string[];
  homeImpact: number;       // 0-1 loss to squad strength
  awayImpact: number;
}

export interface MatchLineup {
  formation: string;         // e.g. "4-3-3"
  homeFormation: string;
  awayFormation: string;
  homeKeyAbsences: string[];
  awayKeyAbsences: string[];
}

// ─── 1. Travel Distance & Jet Lag ───

export function computeTravelData(
  homeTeamId: string,
  awayTeamId: string,
  venueKey: string = '_default'
): TravelData {
  const homeCoord = TEAM_COORDS[homeTeamId];
  const awayCoord = TEAM_COORDS[awayTeamId];
  const venue = VENUES[venueKey] || VENUES['_default'];

  const degToRad = (d: number) => d * Math.PI / 180;
  const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371;
    const dLat = degToRad(lat2 - lat1);
    const dLon = degToRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const homeDist = homeCoord ? haversine(homeCoord.lat, homeCoord.lon, venue.lat, venue.lon) : 1000;
  const awayDist = awayCoord ? haversine(awayCoord.lat, awayCoord.lon, venue.lat, venue.lon) : 1000;

  // Jet lag: timezone difference between team home and venue
  const homeJetLag = homeCoord ? Math.abs((venue.lon - homeCoord.lon) / 15) : 0;
  const awayJetLag = awayCoord ? Math.abs((venue.lon - awayCoord.lon) / 15) : 0;

  // Travel fatigue: distance / 10000 + jetlag effect
  const homeFatigue = Math.min(1, homeDist / 12000 + homeJetLag / 12);
  const awayFatigue = Math.min(1, awayDist / 12000 + awayJetLag / 12);

  return {
    homeDistanceKm: Math.round(homeDist),
    awayDistanceKm: Math.round(awayDist),
    homeJetLag: parseFloat(homeJetLag.toFixed(1)),
    awayJetLag: parseFloat(awayJetLag.toFixed(1)),
    homeTravelFatigue: parseFloat(homeFatigue.toFixed(3)),
    awayTravelFatigue: parseFloat(awayFatigue.toFixed(3)),
  };
}

// ─── 2. Tournament Context ───

export function computeTournamentContext(
  stage: string,
  groupName: string,
  homePts: number, awayPts: number,
  secondPts: number, thirdPts: number,
  homeGD: number, awayGD: number
): TournamentContext {
  const stageWeights: Record<string, number> = {
    'GROUP_STAGE': 1.0, 'ROUND_OF_32': 1.05, 'ROUND_OF_16': 1.10,
    'QUARTER_FINAL': 1.20, 'SEMI_FINAL': 1.30, 'FINAL': 1.50,
  };
  const stageWeight = stageWeights[stage] || 1.0;
  const isKnockout = !!(stage && stage.match(/ROUND|QUARTER|SEMI|FINAL/i));
  const isGroupMatch3 = stage === 'GROUP_STAGE';

  // 默契球检测: 两队分差≤1、净胜球相近、平局对双方都有利
  let collusionPossible = false;
  let collusionDrawProb = 0;
  if (isGroupMatch3) {
    const ptsClose = Math.abs(homePts - awayPts) <= 1;
    const gdClose = Math.abs(homeGD - awayGD) <= 2;
    const bothQualifyWithDraw = (homePts + 1 >= thirdPts) && (awayPts + 1 >= thirdPts);
    collusionPossible = ptsClose && gdClose && bothQualifyWithDraw;
    collusionDrawProb = collusionPossible ? 0.08 : 0; // +8% draw probability
  }

  return {
    stageWeight,
    isKnockout,
    isGroupMatch3,
    collusionPossible,
    collusionDrawProb,
  };
}

// ─── 3. Schedule Density ───

export async function computeScheduleDensity(
  prisma: PrismaClient,
  homeTeamId: string,
  awayTeamId: string,
  matchDate: Date
): Promise<ScheduleDensity> {
  const getRecentMatches = async (teamId: string) => {
    return prisma.match.findMany({
      where: {
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
        status: 'completed', homeScore: { not: null },
        matchDate: { lt: matchDate },
      },
      orderBy: { matchDate: 'desc' },
      take: 5,
    });
  };

  const [homeMatches, awayMatches] = await Promise.all([
    getRecentMatches(homeTeamId), getRecentMatches(awayTeamId),
  ]);

  const calcDays = (ms: any[]) => {
    if (ms.length === 0) return { lastGap: 7, is3in7: false, fatigue: 0 };
    const lastGap = (matchDate.getTime() - new Date(ms[0].matchDate).getTime()) / 86400000;
    // 7天3赛
    if (ms.length >= 2) {
      const thirdGap = (matchDate.getTime() - new Date(ms[2]?.matchDate || ms[ms.length-1].matchDate).getTime()) / 86400000;
      const is3in7 = thirdGap <= 7 && ms.length >= 3;
      const fatigue = is3in7 ? 0.15 : lastGap < 3 ? 0.10 : lastGap < 4 ? 0.05 : 0;
      return { lastGap: Math.round(lastGap), is3in7, fatigue };
    }
    return { lastGap: Math.round(lastGap), is3in7: false, fatigue: lastGap < 3 ? 0.08 : 0 };
  };

  const h = calcDays(homeMatches);
  const a = calcDays(awayMatches);

  return {
    homeDaysSinceLast: h.lastGap,
    awayDaysSinceLast: a.lastGap,
    homeMatch3in7: h.is3in7,
    awayMatch3in7: a.is3in7,
    homeFatigueScore: h.fatigue,
    awayFatigueScore: a.fatigue,
  };
}

// ─── 4. Referee Impact ───

export function getRefereeImpact(refereeId?: string): RefereeImpact {
  const ref = refereeId && REFEREE_DB[refereeId] ? REFEREE_DB[refereeId] : REFEREE_DB['_default'];

  // 越严 = 越多中断 = 越少进球
  const goalImpact = 1 + (0.5 - ref.strictness) * 0.15; // 0.92-1.08

  return {
    name: ref.name,
    strictness: ref.strictness,
    expectedCards: ref.avgYellows,
    expectedPenalties: ref.avgPenalties,
    goalImpact: parseFloat(goalImpact.toFixed(3)),
  };
}

// ─── 5. Card/Suspension Impact ───

export async function computeSuspensionImpact(
  prisma: PrismaClient,
  homeTeamId: string,
  awayTeamId: string,
  matchId: string
): Promise<CardSuspension> {
  // Check for injured players (existing data)
  const [homeInjured, awayInjured] = await Promise.all([
    prisma.playerStats.findMany({
      where: { matchId, isInjured: true, player: { teamId: homeTeamId } },
      include: { player: true },
    }),
    prisma.playerStats.findMany({
      where: { matchId, isInjured: true, player: { teamId: awayTeamId } },
      include: { player: true },
    }),
  ]);

  const calcImpact = (players: any[]) => {
    return Math.min(0.25, players.reduce((s: number, p: any) => s + (p.player?.importance || 0), 0));
  };

  return {
    homeMissing: homeInjured.map((p: any) => p.player?.name || 'Unknown'),
    awayMissing: awayInjured.map((p: any) => p.player?.name || 'Unknown'),
    homeImpact: parseFloat(calcImpact(homeInjured).toFixed(3)),
    awayImpact: parseFloat(calcImpact(awayInjured).toFixed(3)),
  };
}

// ─── 6. Squad Depth Estimator ───

export function estimateSquadDepth(
  missingImpact: number,
  teamRollingGA: number,
  leagueAvgGA: number
): number {
  // If missing key players but recent GA is still good → deep squad
  // If missing key players and recent GA spikes → weak depth
  const depthScore = 1 - (missingImpact * (teamRollingGA / Math.max(leagueAvgGA, 0.5)));
  return parseFloat(Math.max(0.6, Math.min(1.2, depthScore)).toFixed(3));
}

// ─── 7. Match Events Scraper (API-Football free tier) ───

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || '';

export interface MatchEventData {
  shots: { home: number; away: number };
  shotsOnTarget: { home: number; away: number };
  possession: { home: number; away: number };
  corners: { home: number; away: number };
  cards: { homeYellows: number; awayYellows: number; homeReds: number; awayReds: number };
  formation: { home: string; away: string };
  referee: string;
}

export async function fetchMatchEvents(
  matchId: string
): Promise<MatchEventData | null> {
  if (!API_FOOTBALL_KEY) return null;

  try {
    // API-Football v3 fixtures endpoint
    const { data } = await axios.get('https://v3.football.api-sports.io/fixtures', {
      params: { id: matchId },
      headers: { 'x-apisports-key': API_FOOTBALL_KEY },
      timeout: 8000,
    });

    const fixture = data?.response?.[0];
    if (!fixture) return null;

    const stats = fixture.statistics || [];
    const getStat = (type: string) => {
      const s = stats.find((s: any) => s.type === type);
      return s?.value ?? null;
    };

    return {
      shots: { home: getStat('Total Shots')?.home || 0, away: getStat('Total Shots')?.away || 0 },
      shotsOnTarget: { home: getStat('Shots on Goal')?.home || 0, away: getStat('Shots on Goal')?.away || 0 },
      possession: { home: parseInt(getStat('Ball Possession')?.home) || 50, away: parseInt(getStat('Ball Possession')?.away) || 50 },
      corners: { home: getStat('Corner Kicks')?.home || 0, away: getStat('Corner Kicks')?.away || 0 },
      cards: {
        homeYellows: getStat('Yellow Cards')?.home || 0,
        awayYellows: getStat('Yellow Cards')?.away || 0,
        homeReds: getStat('Red Cards')?.home || 0,
        awayReds: getStat('Red Cards')?.away || 0,
      },
      formation: {
        home: fixture.lineups?.[0]?.formation || '4-3-3',
        away: fixture.lineups?.[1]?.formation || '4-4-2',
      },
      referee: fixture.referee || 'Unknown',
    };
  } catch (e: any) {
    if (e.response?.status === 401) {
      console.log('[MatchData] API-Football key invalid or expired');
    }
    return null;
  }
}

// ─── 8. Second Half Adjustment ───

export function computeSecondHalfAdjustment(
  temperature: number,
  humidity: number,
  scheduleFatigue: number
): { secondHalfFactor: number; totalMatchFactor: number } {
  // High temp + humidity → second half drop-off
  const heatIndex = temperature + 0.555 * (6.11 * Math.exp(5417.7530 * (1/273.16 - 1/(273.15 + (humidity > 60 ? temperature * 0.8 : temperature)))));
  const fatigueEffect = (heatIndex > 30 ? 0.05 : 0) + scheduleFatigue * 0.5;

  // Second half: goals drop by fatigue effect
  const secondHalfFactor = parseFloat((1 - fatigueEffect).toFixed(3));

  // Total match: slight reduction
  const totalMatchFactor = parseFloat((1 - fatigueEffect * 0.5).toFixed(3));

  return { secondHalfFactor, totalMatchFactor };
}

// ─── 9. Comprehensive Feature Collection ───

export interface AllMatchContext {
  travel: TravelData;
  tournament: TournamentContext;
  schedule: ScheduleDensity;
  referee: RefereeImpact;
  suspensions: CardSuspension;
  venue: { name: string; altitude: number; capacity: number; surface: string; pitchSize: string };
  matchEvents: MatchEventData | null;
}

export async function collectAllMatchContext(
  prisma: PrismaClient,
  homeTeamId: string,
  awayTeamId: string,
  matchId: string,
  matchDate: Date,
  stage: string,
  groupName: string,
  venueKey: string
): Promise<AllMatchContext> {
  const travel = computeTravelData(homeTeamId, awayTeamId, venueKey);

  // Get group standings for tournament context
  let homePts = 0, awayPts = 0, secondPts = 0, thirdPts = 0, homeGD = 0, awayGD = 0;
  try {
    const groupMatches = await prisma.match.findMany({
      where: { groupName, status: 'completed', homeScore: { not: null } },
    });
    const standings: Record<string, { pts: number; gd: number }> = {};
    const allTeams = new Set<string>();
    const allMatches = await prisma.match.findMany({ where: { groupName } });
    for (const m of allMatches) { allTeams.add(m.homeTeamId); allTeams.add(m.awayTeamId); }
    for (const tid of allTeams) standings[tid] = { pts: 0, gd: 0 };
    for (const m of groupMatches) {
      const h = standings[m.homeTeamId], a = standings[m.awayTeamId];
      if (!h || !a) continue;
      h.gd += m.homeScore! - m.awayScore!;
      a.gd += m.awayScore! - m.homeScore!;
      if (m.homeScore! > m.awayScore!) h.pts += 3;
      else if (m.homeScore === m.awayScore) { h.pts += 1; a.pts += 1; }
      else a.pts += 3;
    }
    const sorted = [...allTeams].map(t => ({ id: t, ...standings[t] }))
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd);
    homePts = standings[homeTeamId]?.pts || 0;
    awayPts = standings[awayTeamId]?.pts || 0;
    homeGD = standings[homeTeamId]?.gd || 0;
    awayGD = standings[awayTeamId]?.gd || 0;
    secondPts = sorted[1]?.pts || 0;
    thirdPts = sorted[2]?.pts || 0;
  } catch {}

  const tournament = computeTournamentContext(stage, groupName, homePts, awayPts, secondPts, thirdPts, homeGD, awayGD);
  const schedule = await computeScheduleDensity(prisma, homeTeamId, awayTeamId, matchDate);
  const referee = getRefereeImpact();
  const suspensions = await computeSuspensionImpact(prisma, homeTeamId, awayTeamId, matchId);
  const venue = VENUES[venueKey] || VENUES['_default'];

  // Try to get match events (API-Football if key available)
  let matchEvents: MatchEventData | null = null;
  try { matchEvents = await fetchMatchEvents(matchId); } catch {}

  return { travel, tournament, schedule, referee, suspensions, venue, matchEvents };
}
