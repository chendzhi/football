const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const [oddsCnt, histCnt, snapCnt] = await Promise.all([
    p.odds.count(), p.oddsHistory.count(), p.oddsSnapshot.count(),
  ]);
  console.log('实时赔率:', oddsCnt, '条');
  console.log('赔率历史:', histCnt, '条');
  console.log('赔率快照:', snapCnt, '条');

  if (histCnt > 0) {
    const latest = await p.oddsHistory.findFirst({ orderBy: { timestamp: 'desc' } });
    console.log('\n最新开盘赔率:', latest.matchId, 'H:', latest.homeOdds, 'D:', latest.drawOdds, 'A:', latest.awayOdds, latest.timestamp.toISOString().slice(0, 19));

    const m41 = await p.oddsHistory.findMany({
      where: { matchId: 'm41' },
      orderBy: { timestamp: 'asc' },
      take: 5,
    });
    console.log('\nm41 赔率走势 (阿根廷vs奥地利):');
    m41.forEach(r => console.log('  ', r.timestamp.toISOString().slice(0, 19), 'H:' + r.homeOdds, 'D:' + r.drawOdds, 'A:' + r.awayOdds));
  }

  if (oddsCnt > 0) {
    const o = await p.odds.findFirst({ orderBy: { updatedAt: 'desc' } });
    console.log('\n当前实时赔率:', o.matchId, 'H:' + o.currentHomeOdds, 'D:' + o.currentDrawOdds, 'A:' + o.currentAwayOdds, o.updatedAt?.toISOString()?.slice(0, 19));
  }

  await p.$disconnect();
}
main();
