const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.predictionHistory.findMany({
  orderBy: { createdAt: 'desc' }, take: 5,
  include: { match: { select: { homeTeamId: true, awayTeamId: true } } }
}).then(rows => {
  rows.forEach(r => {
    console.log(r.matchId, r.match.homeTeamId, 'vs', r.match.awayTeamId,
      '|', (r.predHomeWin*100).toFixed(1)+'/'+(r.predDraw*100).toFixed(1)+'/'+(r.predAwayWin*100).toFixed(1),
      '| actual:', r.actualOutcome || '-',
      '|', r.createdAt?.toISOString());
  });
  return p.$disconnect();
});
