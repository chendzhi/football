import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('>> [SEED] 正在注入初始数据...');

  await prisma.predictionHistory.deleteMany({});
  await prisma.playerStats.deleteMany({});
  await prisma.player.deleteMany({});
  await prisma.oddsHistory.deleteMany({});
  await prisma.odds.deleteMany({});
  await prisma.featureSnapshot.deleteMany({});
  await prisma.match.deleteMany({});
  await prisma.teamStats.deleteMany({});
  await prisma.team.deleteMany({});

  const teams = [
    { id: 't1', name: 'Mexico', chinaName: '墨西哥', shortName: 'MEX', flagUrl: '🇲🇽', eloRating: 1930 },
    { id: 't2', name: 'South Africa', chinaName: '南非', shortName: 'RSA', flagUrl: '🇿🇦', eloRating: 1810 },
    { id: 't3', name: 'South Korea', chinaName: '韩国', shortName: 'KOR', flagUrl: '🇰🇷', eloRating: 1890 },
    { id: 't4', name: 'Czechia', chinaName: '捷克', shortName: 'CZE', flagUrl: '🇨🇿', eloRating: 1755 }
  ];

  for (const t of teams) {
    await prisma.team.create({
      data: {
        id: t.id,
        name: t.name,
        chinaName: t.chinaName,
        shortName: t.shortName,
        flagUrl: t.flagUrl,
        eloRating: t.eloRating
      }
    });

    await prisma.teamStats.create({
      data: {
        id: `s_${t.id}`,
        teamId: t.id,
        matchDate: new Date(),
        expectedGoalsFor: t.id === 't1' ? 1.85 : t.id === 't3' ? 1.65 : 1.2,
        expectedGoalsAgst: t.id === 't1' ? 0.95 : t.id === 't3' ? 1.1 : 1.45,
        formScore: t.id === 't1' ? 0.85 : 0.6
      }
    });
  }

  await prisma.player.create({ data: { id: 'p1', teamId: 't1', name: 'Santiago Giménez', importance: 0.25 } });
  await prisma.player.create({ data: { id: 'p2', teamId: 't3', name: 'Son Heung-min', importance: 0.3 } });

  await prisma.match.create({
    data: {
      id: 'm1',
      matchDate: new Date('2026-06-11T20:00:00Z'),
      groupName: 'Group A',
      stage: 'GROUP_STAGE',
      homeTeamId: 't1',
      awayTeamId: 't2'
    }
  });

  await prisma.match.create({
    data: {
      id: 'm2',
      matchDate: new Date('2026-06-12T15:00:00Z'),
      groupName: 'Group B',
      stage: 'GROUP_STAGE',
      homeTeamId: 't3',
      awayTeamId: 't4'
    }
  });

  await prisma.odds.create({
    data: {
      id: 'o1',
      matchId: 'm1',
      currentHomeOdds: 1.55,
      currentDrawOdds: 3.8,
      currentAwayOdds: 6.5
    }
  });

  await prisma.odds.create({
    data: {
      id: 'o2',
      matchId: 'm2',
      currentHomeOdds: 1.72,
      currentDrawOdds: 3.6,
      currentAwayOdds: 5.0
    }
  });

  await prisma.oddsHistory.create({
    data: {
      id: 'oh1',
      matchId: 'm1',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6),
      homeOdds: 1.7,
      drawOdds: 3.9,
      awayOdds: 6.8
    }
  });

  await prisma.oddsHistory.create({
    data: {
      id: 'oh2',
      matchId: 'm1',
      timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2),
      homeOdds: 1.6,
      drawOdds: 3.8,
      awayOdds: 6.3
    }
  });

  await prisma.playerStats.create({ data: { id: 'ps1', playerId: 'p1', matchId: 'm1', isInjured: false } });
  await prisma.playerStats.create({ data: { id: 'ps2', playerId: 'p2', matchId: 'm2', isInjured: true } });

  // Add a completed match for evaluation testing
  await prisma.match.create({
    data: {
      id: 'm3',
      matchDate: new Date('2026-06-10T18:00:00Z'),
      groupName: 'Group A',
      stage: 'GROUP_STAGE',
      homeTeamId: 't1',
      awayTeamId: 't2',
      status: 'completed'
    }
  });

  await prisma.predictionHistory.create({
    data: {
      id: 'ph_eval_1',
      matchId: 'm3',
      teamId: 't1',
      predHomeWin: 0.62,
      predDraw: 0.22,
      predAwayWin: 0.16,
      actualOutcome: 'H',
      featureVersion: 'feature_v1.0',
      modelVersion: 'lambda_v1.0',
      simulationVersion: 'simulation_v1.0'
    }
  });

  console.log('✅ [SEED] 初始数据注入完成。');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
