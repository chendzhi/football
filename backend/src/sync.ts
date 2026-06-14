/**
 * 数据同步脚本 — 从 API-Football v3 拉取真实比赛数据
 *
 * 免费 API Key: https://dashboard.api-football.com/
 * 免费额度: 100 请求/天
 *
 * 用法:
 *   npx ts-node -r dotenv/config src/sync.ts
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';

// -------------------- CONFIG --------------------

const prisma = new PrismaClient();

const API_KEY = process.env.API_FOOTBALL_KEY || '';
const LEAGUE = parseInt(process.env.SYNC_LEAGUE || '1', 10);
const SEASON = parseInt(process.env.SYNC_SEASON || '2022', 10);

// Max API calls budget (free tier: 100/day, leave margin)
const MAX_API_CALLS = 80;

const api = axios.create({
  baseURL: 'https://v3.football.api-sports.io',
  headers: {
    'x-apisports-key': API_KEY,
  },
  timeout: 15000,
});

let apiCalls = 0;

async function apiGet<T = any>(path: string, params: Record<string, any> = {}): Promise<T> {
  if (apiCalls >= MAX_API_CALLS) {
    throw new Error(`已达 API 调用上限 ${MAX_API_CALLS}，停止以避免超额`);
  }
  apiCalls++;
  const label = params.fixture ? `odds?fixture=${params.fixture}` :
                 params.team   ? `stats/players?team=${params.team}` :
                 path;
  console.log(`  [API #${apiCalls}] GET ${label}`);
  const { data } = await api.get(path, { params });
  return data;
}

// -------------------- CLEAN DB --------------------

async function cleanDb() {
  await prisma.predictionHistory.deleteMany();
  await prisma.playerStats.deleteMany();
  await prisma.player.deleteMany();
  await prisma.oddsHistory.deleteMany();
  await prisma.odds.deleteMany();
  await prisma.featureSnapshot.deleteMany();
  await prisma.match.deleteMany();
  await prisma.teamStats.deleteMany();
  await prisma.team.deleteMany();
}

// -------------------- LEAGUE NAME --------------------

const LEAGUE_NAMES: Record<number, string> = {
  1: 'World Cup', 2: 'Champions League', 3: 'Europa League',
  4: 'Euro Championship', 39: 'Premier League', 140: 'La Liga',
  135: 'Serie A', 78: 'Bundesliga', 61: 'Ligue 1',
};

// -------------------- REAL API SYNC --------------------

async function syncFromApi() {
  console.log(`🔑 API-Football Key: ${API_KEY.slice(0, 8)}...`);
  console.log(`📡 League=${LEAGUE} (${LEAGUE_NAMES[LEAGUE] || 'Unknown'}) Season=${SEASON}\n`);

  // === Step 1: Fetch teams ===
  console.log('📋 [1/5] 拉取球队...');
  const teamsRes = await apiGet<{
    response: Array<{ team: { id: number; name: string; code: string; country: string; logo: string } }>;
  }>('/teams', { league: LEAGUE, season: SEASON });

  const apiTeams = teamsRes.response;
  console.log(`   → ${apiTeams.length} 支球队\n`);

  // === Step 2: Fetch fixtures (all matches) ===
  console.log('📅 [2/5] 拉取比赛...');
  const fixRes = await apiGet<{
    response: Array<{
      fixture: { id: number; date: string; status: { short: string; long: string } };
      league: { round: string; name: string };
      teams: { home: { id: number; name: string }; away: { id: number; name: string } };
      goals: { home: number | null; away: number | null };
      score: { penalty: { home: number | null; away: number | null } };
    }>;
  }>('/fixtures', { league: LEAGUE, season: SEASON });

  const apiFixtures = fixRes.response;
  console.log(`   → ${apiFixtures.length} 场比赛\n`);

  // === Step 3: Fetch odds for key matches (limit to preserve budget) ===
  // Priority: knockout stage matches → completed matches → all
  const keyFixtures = apiFixtures.filter(f => {
    const stage = f.league.round?.toUpperCase() || '';
    return stage.includes('FINAL') || stage.includes('SEMI') ||
           stage.includes('QUARTER') || stage.includes('ROUND OF 16') ||
           stage.includes('KNOCKOUT');
  });

  // If < 10 knockout matches, add some group stage matches
  const oddsFixtures = keyFixtures.length >= 10
    ? keyFixtures.slice(0, 30)
    : [...keyFixtures, ...apiFixtures.filter(f => !keyFixtures.includes(f))].slice(0, 30);

  console.log(`🎰 [3/5] 拉取赔率 (${oddsFixtures.length} 场关键比赛)...`);

  const oddsMap = new Map<number, { home: number; draw: number; away: number }>();
  for (const f of oddsFixtures) {
    try {
      const oddsRes = await apiGet<any>('/odds', { fixture: f.fixture.id });

      // API returns response: [{ bookmakers: [...] }]
      const oddsData = oddsRes.response as any[];
      if (oddsData.length > 0 && oddsData[0].bookmakers?.length > 0) {
        const bookmaker = oddsData[0].bookmakers[0];
        const matchWinner = bookmaker.bets?.find((b: any) => b.name === 'Match Winner');
        if (matchWinner) {
          const homeVal = matchWinner.values?.find((v: any) => v.value === 'Home');
          const drawVal = matchWinner.values?.find((v: any) => v.value === 'Draw');
          const awayVal = matchWinner.values?.find((v: any) => v.value === 'Away');
          if (homeVal && drawVal && awayVal) {
            oddsMap.set(f.fixture.id, {
              home: parseFloat(homeVal.odd),
              draw: parseFloat(drawVal.odd),
              away: parseFloat(awayVal.odd),
            });
          }
        }
      }
    } catch (e: any) {
      console.error(`      ⚠️  odds failed for fixture ${f.fixture.id}: ${e.response?.status || e.message}`);
    }
  }
  console.log(`   → 获取到 ${oddsMap.size} 组赔率\n`);

  // === Step 4: Fetch team stats for top teams ===
  const budgetRemaining = MAX_API_CALLS - apiCalls - 5; // save 5 for safety
  const topTeams = apiTeams.slice(0, Math.min(apiTeams.length, budgetRemaining));

  console.log(`📊 [4/5] 拉取球队统计 (${topTeams.length} 队)...`);

  const statsMap = new Map<number, { gf: number; ga: number; form: number }>();
  for (const t of topTeams) {
    try {
      const statsRes = await apiGet<{
        response: {
          fixtures: { played: { total: number }; wins: { total: number }; draws: { total: number }; loses: { total: number } };
          goals: { for: { average: { total: string } }; against: { average: { total: string } } };
          biggest: { streak: { wins: number; draws: number; loses: number } };
          form?: string;
        };
      }>('/teams/statistics', { league: LEAGUE, season: SEASON, team: t.team.id });

      const s = statsRes.response;
      const gp = s.fixtures.played.total;
      const wins = s.fixtures.wins.total;
      const draws = s.fixtures.draws.total;
      const formScore = gp > 0 ? (wins * 3 + draws) / (gp * 3) : 0.5;

      statsMap.set(t.team.id, {
        gf: parseFloat(s.goals.for.average.total) || 1.3,
        ga: parseFloat(s.goals.against.average.total) || 1.3,
        form: parseFloat(formScore.toFixed(2)),
      });
    } catch (e: any) {
      console.error(`      ⚠️  stats failed for team ${t.team.id}: ${e.response?.status || e.message}`);
    }
  }
  console.log(`   → 获取到 ${statsMap.size} 队统计数据\n`);

  // === Step 5: Write to database ===
  console.log('💾 [5/5] 写入数据库...');
  await cleanDb();

  // Write teams
  for (const t of apiTeams) {
    const stats = statsMap.get(t.team.id);
    // ELO estimate: 2200 for top teams, scaled by league position
    const idx = apiTeams.indexOf(t);
    const eloEstimate = Math.round(2100 - (idx / apiTeams.length) * 400);

    await prisma.team.create({
      data: {
        id: String(t.team.id),
        name: t.team.name,
        chinaName: t.team.name, // API 无中文名，保留原名
        shortName: t.team.code || t.team.name.slice(0, 3).toUpperCase(),
        flagUrl: t.team.logo,
        eloRating: eloEstimate,
      },
    });

    await prisma.teamStats.create({
      data: {
        id: `s_${t.team.id}`,
        teamId: String(t.team.id),
        matchDate: new Date(),
        expectedGoalsFor: stats?.gf ?? 1.3,
        expectedGoalsAgst: stats?.ga ?? 1.3,
        formScore: stats?.form ?? 0.5,
      },
    });
  }

  // Write matches
  let completedCount = 0;
  let scheduledCount = 0;

  for (const f of apiFixtures) {
    const statusShort = f.fixture.status.short;
    const isFinished = ['FT', 'AET', 'PEN'].includes(statusShort);
    const hasScore = f.goals.home !== null && f.goals.away !== null;

    await prisma.match.create({
      data: {
        id: String(f.fixture.id),
        matchDate: new Date(f.fixture.date),
        groupName: f.league.round || f.league.name || 'Unknown',
        stage: f.league.round || 'GROUP_STAGE',
        homeTeamId: String(f.teams.home.id),
        awayTeamId: String(f.teams.away.id),
        status: isFinished ? 'completed' : 'scheduled',
      },
    });

    // Write odds if available
    const odd = oddsMap.get(f.fixture.id);
    if (odd) {
      await prisma.odds.create({
        data: {
          id: `o_${f.fixture.id}`,
          matchId: String(f.fixture.id),
          currentHomeOdds: odd.home,
          currentDrawOdds: odd.draw,
          currentAwayOdds: odd.away,
        },
      });
    }

    // Write PredictionHistory for completed matches (with actual outcome)
    if (isFinished && hasScore) {
      completedCount++;
      const hg = f.goals.home!;
      const ag = f.goals.away!;

      let outcome = 'D';
      if (f.score.penalty?.home != null && f.score.penalty?.away != null) {
        outcome = f.score.penalty.home > f.score.penalty.away ? 'H' : 'A';
      } else if (hg > ag) {
        outcome = 'H';
      } else if (ag > hg) {
        outcome = 'A';
      }

      // Use odds-implied probabilities or placeholder
      const implied = odd
        ? { h: 1/odd.home, d: 1/odd.draw, a: 1/odd.away }
        : { h: 0.4, d: 0.3, a: 0.3 };
      const total = implied.h + implied.d + implied.a;

      await prisma.predictionHistory.create({
        data: {
          id: `ph_${f.fixture.id}`,
          matchId: String(f.fixture.id),
          teamId: String(f.teams.home.id),
          predHomeWin: parseFloat((implied.h / total).toFixed(4)),
          predDraw: parseFloat((implied.d / total).toFixed(4)),
          predAwayWin: parseFloat((implied.a / total).toFixed(4)),
          actualOutcome: outcome,
          featureVersion: 'api_sync_v1.0',
          modelVersion: 'market_implied_v1.0',
          simulationVersion: 'simulation_v1.0',
        },
      });
    } else {
      scheduledCount++;
    }
  }

  // === Summary ===
  console.log(`\n✅ 同步完成!`);
  console.log(`   ${'='.repeat(40)}`);
  console.log(`   ${apiTeams.length} 支球队 · ${apiFixtures.length} 场比赛`);
  console.log(`   ${completedCount} 场已完成 (含真实赛果) · ${scheduledCount} 场待进行`);
  console.log(`   ${oddsMap.size} 组赔率 · ${statsMap.size} 队统计数据`);
  console.log(`   API 请求: ${apiCalls}/${MAX_API_CALLS}`);
  console.log(`   ${'='.repeat(40)}`);
}

// -------------------- DEMO FALLBACK --------------------

async function useDemoData() {
  console.log('⚠️  无 API Key，使用 世界杯 2022 淘汰赛 demo 数据\n');

  await cleanDb();

  const demoTeams = [
    { id: 'arg', name: 'Argentina',  china: '阿根廷',   code: 'ARG', flag: '🇦🇷', elo: 2100 },
    { id: 'fra', name: 'France',     china: '法国',     code: 'FRA', flag: '🇫🇷', elo: 2080 },
    { id: 'bra', name: 'Brazil',     china: '巴西',     code: 'BRA', flag: '🇧🇷', elo: 2070 },
    { id: 'eng', name: 'England',    china: '英格兰',   code: 'ENG', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', elo: 2030 },
    { id: 'ned', name: 'Netherlands',china: '荷兰',     code: 'NED', flag: '🇳🇱', elo: 2010 },
    { id: 'cro', name: 'Croatia',    china: '克罗地亚', code: 'CRO', flag: '🇭🇷', elo: 2000 },
    { id: 'mar', name: 'Morocco',    china: '摩洛哥',   code: 'MAR', flag: '🇲🇦', elo: 1970 },
    { id: 'por', name: 'Portugal',   china: '葡萄牙',   code: 'POR', flag: '🇵🇹', elo: 2060 },
    { id: 'esp', name: 'Spain',      china: '西班牙',   code: 'ESP', flag: '🇪🇸', elo: 2040 },
    { id: 'ger', name: 'Germany',    china: '德国',     code: 'GER', flag: '🇩🇪', elo: 1990 },
    { id: 'bel', name: 'Belgium',    china: '比利时',   code: 'BEL', flag: '🇧🇪', elo: 1985 },
    { id: 'jpn', name: 'Japan',      china: '日本',     code: 'JPN', flag: '🇯🇵', elo: 1950 },
    { id: 'sen', name: 'Senegal',    china: '塞内加尔', code: 'SEN', flag: '🇸🇳', elo: 1920 },
    { id: 'usa', name: 'USA',        china: '美国',     code: 'USA', flag: '🇺🇸', elo: 1935 },
    { id: 'pol', name: 'Poland',     china: '波兰',     code: 'POL', flag: '🇵🇱', elo: 1900 },
    { id: 'kor', name: 'South Korea',china: '韩国',     code: 'KOR', flag: '🇰🇷', elo: 1890 },
  ];

  for (const t of demoTeams) {
    await prisma.team.create({
      data: { id: t.id, name: t.name, chinaName: t.china, shortName: t.code, flagUrl: t.flag, eloRating: t.elo },
    });
    await prisma.teamStats.create({
      data: {
        id: `s_${t.id}`, teamId: t.id, matchDate: new Date('2022-12-18'),
        expectedGoalsFor: parseFloat((1.0 + t.elo / 1000).toFixed(2)),
        expectedGoalsAgst: parseFloat((1.8 - (t.elo - 1800) / 800).toFixed(2)),
        formScore: parseFloat((0.4 + (t.elo - 1800) / 1200).toFixed(2)),
      },
    });
  }

  const matchData = [
    { id: 'wc_qf1',  date: '2022-12-09T15:00:00Z', stage: 'QUARTER_FINAL', h: 'bra', a: 'cro', hs: 1, as: 1, pen: 'away', odds: [1.85, 3.4, 4.5] },
    { id: 'wc_qf2',  date: '2022-12-09T19:00:00Z', stage: 'QUARTER_FINAL', h: 'ned', a: 'arg', hs: 2, as: 2, pen: 'away', odds: [3.8, 3.2, 2.05] },
    { id: 'wc_qf3',  date: '2022-12-10T15:00:00Z', stage: 'QUARTER_FINAL', h: 'mar', a: 'por', hs: 1, as: 0, pen: null,  odds: [6.5, 3.8, 1.55] },
    { id: 'wc_qf4',  date: '2022-12-10T19:00:00Z', stage: 'QUARTER_FINAL', h: 'eng', a: 'fra', hs: 1, as: 2, pen: null,  odds: [2.7, 3.1, 2.7] },
    { id: 'wc_sf1',  date: '2022-12-13T19:00:00Z', stage: 'SEMI_FINAL',    h: 'arg', a: 'cro', hs: 3, as: 0, pen: null,  odds: [1.8, 3.4, 4.8] },
    { id: 'wc_sf2',  date: '2022-12-14T19:00:00Z', stage: 'SEMI_FINAL',    h: 'fra', a: 'mar', hs: 2, as: 0, pen: null,  odds: [1.45, 4.2, 7.5] },
    { id: 'wc_3rd',  date: '2022-12-17T15:00:00Z', stage: 'THIRD_PLACE',   h: 'cro', a: 'mar', hs: 2, as: 1, pen: null,  odds: [2.1, 3.5, 3.3] },
    { id: 'wc_fin',  date: '2022-12-18T15:00:00Z', stage: 'FINAL',         h: 'arg', a: 'fra', hs: 3, as: 3, pen: 'home', odds: [2.6, 3.1, 2.8] },
  ];

  for (const m of matchData) {
    await prisma.match.create({
      data: { id: m.id, matchDate: new Date(m.date), groupName: 'World Cup 2022', stage: m.stage, homeTeamId: m.h, awayTeamId: m.a, status: 'completed' },
    });
    await prisma.odds.create({
      data: { id: `o_${m.id}`, matchId: m.id, currentHomeOdds: m.odds[0], currentDrawOdds: m.odds[1], currentAwayOdds: m.odds[2] },
    });

    let out = 'D';
    if (m.pen === 'home') out = 'H';
    else if (m.pen === 'away') out = 'A';
    else if ((m.hs ?? 0) > (m.as ?? 0)) out = 'H';
    else if ((m.as ?? 0) > (m.hs ?? 0)) out = 'A';

    const imp = { h: 1/m.odds[0], d: 1/m.odds[1], a: 1/m.odds[2] };
    const t = imp.h + imp.d + imp.a;

    await prisma.predictionHistory.create({
      data: {
        id: `ph_${m.id}`, matchId: m.id, teamId: m.h,
        predHomeWin: parseFloat((imp.h / t).toFixed(4)),
        predDraw: parseFloat((imp.d / t).toFixed(4)),
        predAwayWin: parseFloat((imp.a / t).toFixed(4)),
        actualOutcome: out,
        featureVersion: 'odds_implied', modelVersion: 'market_v1.0', simulationVersion: 'simulation_v1.0',
      },
    });
  }

  console.log(`\n✅ Demo: ${demoTeams.length} 队 · ${matchData.length} 场 (世界杯 2022 淘汰赛) · 含赔率 + 赛果`);
}

// -------------------- MAIN --------------------

async function main() {
  console.log('⚽ Football Data Sync (API-Football v3)\n');

  if (!API_KEY || API_KEY === 'your_key_here') {
    await useDemoData();
  } else {
    try {
      await syncFromApi();
    } catch (err: any) {
      const status = err.response?.status;
      const msg = err.response?.data?.message || err.message;
      console.error(`\n❌ 同步失败 [${status}]: ${msg}`);

      if (status === 429) console.log('⏳ 触发频率限制，请稍后重试');
      else if (status === 403 || status === 401) console.log('🔑 API Key 无效');
      else if (status === 404) console.log('📭 League/Season 不存在');

      console.log('🔄 回退到 Demo 数据...');
      await useDemoData();
    }
  }

  await prisma.$disconnect();
  console.log('\n🏁 同步结束。运行 npm run dev 启动预测引擎。');
}

main().catch(async (e) => {
  console.error('❌', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
