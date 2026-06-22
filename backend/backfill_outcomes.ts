const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const preds = await p.predictionHistory.findMany({
    where: { actualOutcome: null },
    include: { match: { select: { homeScore: true, awayScore: true } } },
  });
  console.log('待回填:', preds.length);

  let updated = 0;
  for (const r of preds) {
    if (r.match && r.match.homeScore != null) {
      const h = r.match.homeScore, a = r.match.awayScore;
      const o = h > a ? 'H' : h < a ? 'A' : 'D';
      await p.predictionHistory.update({ where: { id: r.id }, data: { actualOutcome: o } });
      updated++;
    }
  }
  console.log('已回填:', updated);

  const total = await p.predictionHistory.count({ where: { actualOutcome: { not: null } } });
  console.log('总有结果记录:', total);
  await p.$disconnect();
}
main();
