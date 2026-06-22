/**
 * 比分同步 — 从 worldcup26.ir 免费 API 拉取完场比分
 *
 * 数据源: https://worldcup26.ir/get/games
 * 用法: npx ts-node src/sync-scores.ts
 */
import { PrismaClient } from '@prisma/client';
import { eloUpdate, eloExpected } from './feature';

const API_URL = 'https://worldcup26.ir/get/games';

const prisma = new PrismaClient();

// English team name → our team ID
const TEAM_NAME_MAP: Record<string, string> = {
  'Mexico': 'mex',
  'South Africa': 'rsa',
  'South Korea': 'kor',
  'Czech Republic': 'cze',
  'Canada': 'can',
  'Bosnia and Herzegovina': 'bih',
  'United States': 'usa',
  'Paraguay': 'par',
  'Qatar': 'qat',
  'Switzerland': 'sui',
  'Brazil': 'bra',
  'Morocco': 'mar',
  'Haiti': 'hai',
  'Scotland': 'sco',
  'Australia': 'aus',
  'Turkey': 'tur',
  'Germany': 'ger',
  'Curaçao': 'cuw',
  'Ivory Coast': 'civ',
  'Ecuador': 'ecu',
  'Netherlands': 'ned',
  'Japan': 'jpn',
  'Sweden': 'swe',
  'Tunisia': 'tun',
  'Spain': 'esp',
  'Cape Verde': 'cpv',
  'Saudi Arabia': 'ksa',
  'Uruguay': 'uru',
  'Belgium': 'bel',
  'Egypt': 'egy',
  'Iran': 'irn',
  'New Zealand': 'nzl',
  'France': 'fra',
  'Senegal': 'sen',
  'Iraq': 'irq',
  'Norway': 'nor',
  'Argentina': 'arg',
  'Algeria': 'alg',
  'Austria': 'aut',
  'Jordan': 'jor',
  'Portugal': 'por',
  'Colombia': 'col',
  'DR Congo': 'cod',
  'Democratic Republic of the Congo': 'cod',
  'Uzbekistan': 'uzb',
  'England': 'eng',
  'Croatia': 'cro',
  'Ghana': 'gha',
  'Panama': 'pan',
};

async function fetchScores(): Promise<any[]> {
  const response = await fetch(API_URL);
  const data: any = await response.json();
  return data.games || [];
}

async function syncScores() {
  console.log('📡 Fetching scores from worldcup26.ir...');
  const games = await fetchScores();
  const finished = games.filter((g: any) => g.finished === 'TRUE');
  console.log(`   Total: ${games.length} games, Finished: ${finished.length}\n`);

  let updated = 0;
  let skipped = 0;

  for (const g of finished) {
    const homeId = TEAM_NAME_MAP[g.home_team_name_en];
    const awayId = TEAM_NAME_MAP[g.away_team_name_en];

    if (!homeId || !awayId) {
      console.log(`   ⚠️  Unknown team: ${g.home_team_name_en} vs ${g.away_team_name_en}`);
      skipped++;
      continue;
    }

    const hs = parseInt(g.home_score);
    const as = parseInt(g.away_score);
    if (isNaN(hs) || isNaN(as)) {
      skipped++;
      continue;
    }

    // Find match in DB
    const match = await prisma.match.findFirst({
      where: {
        homeTeamId: homeId,
        awayTeamId: awayId,
        status: { in: ['scheduled', 'completed'] },
      },
    });

    if (!match) {
      console.log(`   ⚠️  Match not found: ${g.home_team_name_en} vs ${g.away_team_name_en}`);
      skipped++;
      continue;
    }

    if (match.status === 'completed' && match.homeScore === hs && match.awayScore === as) {
      // Already up to date
      continue;
    }

    const outcome = hs > as ? 'H' : hs < as ? 'A' : 'D';

    // Update match
    await prisma.match.update({
      where: { id: match.id },
      data: { status: 'completed', homeScore: hs, awayScore: as },
    });

    // Backfill prediction history
    await prisma.predictionHistory.updateMany({
      where: { matchId: match.id, actualOutcome: null },
      data: { actualOutcome: outcome },
    });

    // Upsert prediction history
    await prisma.predictionHistory.upsert({
      where: { id: `api_ph_${match.id}` },
      update: { actualOutcome: outcome },
      create: {
        id: `api_ph_${match.id}`,
        matchId: match.id,
        teamId: match.homeTeamId,
        predHomeWin: 0.4,
        predDraw: 0.3,
        predAwayWin: 0.3,
        actualOutcome: outcome,
        featureVersion: 'api_sync_v1',
        modelVersion: 'v4',
        simulationVersion: 'v4',
      },
    });

    // Update ELO
    const ht = await prisma.team.findUnique({ where: { id: homeId } });
    const at = await prisma.team.findUnique({ where: { id: awayId } });
    if (ht && at) {
      const exp = eloExpected(ht.eloRating, at.eloRating);
      const act = outcome === 'H' ? 1 : outcome === 'D' ? 0.5 : 0;
      await prisma.team.update({
        where: { id: homeId },
        data: { eloRating: eloUpdate(ht.eloRating, exp, act) },
      });
      await prisma.team.update({
        where: { id: awayId },
        data: { eloRating: eloUpdate(at.eloRating, 1 - exp, 1 - act) },
      });
    }

    console.log(`   ⚽ ${g.home_team_name_en} ${hs}-${as} ${g.away_team_name_en} (${outcome}) → ${match.id}`);
    updated++;
  }

  console.log(`\n✅ Score sync done: ${updated} updated, ${skipped} skipped`);
}

syncScores()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error('❌', e.message);
    prisma.$disconnect();
    process.exit(1);
  });
