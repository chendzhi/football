/**
 * Reset script: clear old predictions, regenerate with new ELOs
 */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // Delete old predictions
  const d1 = await p.predictionHistory.deleteMany({});
  const d2 = await p.featureSnapshot.deleteMany({});
  console.log('Deleted:', d1.count, 'predictions,', d2.count, 'snapshots');
  await p.$disconnect();
}
main();
