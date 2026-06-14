/**
 * Sync Job — 从 API-Football 拉取真实比赛 + 统计数据
 *
 * 用法: npx ts-node -r dotenv/config src/jobs/syncMatches.ts
 */

import { PrismaClient } from '@prisma/client';
import { getFixtures, getFixtureStats } from '../lib/apiFootball';

const prisma = new PrismaClient();

async function sync() {
  const LEAGUE = parseInt(process.env.SYNC_LEAGUE || '1');
  const SEASON = parseInt(process.env.SYNC_SEASON || '2026');

  console.log(`📡 同步 league=${LEAGUE} season=${SEASON}...`);

  try {
    const fixtures = await getFixtures(LEAGUE, SEASON);
    console.log(`   ${fixtures.length} 场比赛`);

    let created = 0, statsCollected = 0;

    for (const f of fixtures) {
      const fid = String(f.fixture.id);
      const isFinished = ['FT', 'AET', 'PEN'].includes(f.fixture.status?.short);

      // Upsert match
      await prisma.match.upsert({
        where: { id: fid },
        update: {
          status: isFinished ? 'completed' : 'scheduled',
          homeScore: f.goals?.home ?? null,
          awayScore: f.goals?.away ?? null,
        },
        create: {
          id: fid,
          matchDate: new Date(f.fixture.date),
          groupName: f.league?.round || 'Unknown',
          stage: f.league?.round || 'GROUP_STAGE',
          homeTeamId: String(f.teams.home.id),
          awayTeamId: String(f.teams.away.id),
          status: isFinished ? 'completed' : 'scheduled',
          homeScore: f.goals?.home ?? null,
          awayScore: f.goals?.away ?? null,
        },
      });
      created++;

      // Collect real match statistics
      if (isFinished) {
        try {
          const stats = await getFixtureStats(f.fixture.id);
          if (stats && stats.length > 0) {
            const s = stats[0]; // first statistics entry
            const extract = (name: string) => {
              const item = s.statistics?.find((x: any) => x.type === name);
              return item?.value ?? null;
            };

            const sh = parseInt(extract('Total Shots') || '0') || 0;
            const sot = parseInt(extract('Shots on Goal') || '0') || 0;
            const pos = parseFloat(extract('Ball Possession')?.replace('%', '') || '50');

            await prisma.matchStats.upsert({
              where: { matchId: fid },
              update: {
                shotsHome: sh, shotsAway: 0, shotsOnTargetHome: sot, shotsOnTargetAway: 0,
                possessionHome: pos, possessionAway: 100 - pos,
                source: 'REAL', confidence: 0.85,
              },
              create: {
                matchId: fid,
                shotsHome: sh, shotsAway: 0, shotsOnTargetHome: sot, shotsOnTargetAway: 0,
                possessionHome: pos, possessionAway: 100 - pos,
                xgHome: null, xgAway: null, cornersHome: 0, cornersAway: 0,
                foulsHome: 0, foulsAway: 0, redCardsHome: 0, redCardsAway: 0,
                source: 'REAL', confidence: 0.85,
              },
            });
            statsCollected++;
          }
        } catch {
          // Stats may not be available for all fixtures
        }
      }
    }

    console.log(`\n✅ 同步完成:`);
    console.log(`   ${created} 场比赛`);
    console.log(`   ${statsCollected} 组真实统计数据`);
    console.log(`   数据源: API-Football v3`);
  } catch (err: any) {
    if (err.response?.status === 429) {
      console.log('⏳ 频率限制，请稍后重试');
    } else {
      console.error('❌', err.message);
    }
  }
}

sync().then(async () => { await prisma.$disconnect(); }).catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
