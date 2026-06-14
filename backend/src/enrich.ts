/**
 * 数据增强脚本 — 从已有比赛结果计算球队统计、ELO、赔率
 *
 * 无需额外 API 调用，完全从 match 数据推导。
 *
 * 用法: npx ts-node -r dotenv/config src/enrich.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TeamStatsComputed {
  gf: number;    // avg goals for per match
  ga: number;    // avg goals against per match
  form: number;  // 0.0 - 1.0
  elo: number;   // ELO rating
}

async function main() {
  console.log('📊 Enrich: 从比赛数据计算统计\n');

  // 1. Load all completed matches
  const matches = await prisma.match.findMany({
    where: { status: 'completed' },
    include: {
      homeTeam: true,
      awayTeam: true,
      predictions: true,
    },
    orderBy: { matchDate: 'asc' },
  });

  console.log(`   加载 ${matches.length} 场已完成比赛`);

  // 2. Compute per-team stats from match results
  const teamMap = new Map<string, {
    gf_total: number; ga_total: number; gp: number;
    recent: string[]; // last 5 results: W/D/L
    matches_played: Array<{ date: Date; opponentElo: number; result: number }>;
  }>();

  for (const m of matches) {
    const hId = m.homeTeamId;
    const aId = m.awayTeamId;
    // Find actual score from PredictionHistory
    const pred = m.predictions[0];
    if (!pred?.actualOutcome) continue;

    const outcome = pred.actualOutcome;
    const hg = outcome === 'H' ? 1 : outcome === 'D' ? 0.5 : 0; // result: 1=win, 0.5=draw, 0=lose
    const ag = 1 - (outcome === 'D' ? 0.5 : outcome === 'A' ? 1 : 0);

    // Initialize team data
    [hId, aId].forEach(id => {
      if (!teamMap.has(id)) teamMap.set(id, { gf_total: 0, ga_total: 0, gp: 0, recent: [], matches_played: [] });
    });

    const hData = teamMap.get(hId)!;
    const aData = teamMap.get(aId)!;

    // Use predicted score from PredictionHistory matching
    // If pred is odds-based, we estimate goals from outcome
    const estHomeGoals = outcome === 'H' ? 2.0 : outcome === 'D' ? 1.2 : 0.8;
    const estAwayGoals = outcome === 'A' ? 2.0 : outcome === 'D' ? 1.2 : 0.8;

    hData.gf_total += estHomeGoals;
    hData.ga_total += estAwayGoals;
    hData.gp++;
    hData.recent.push(outcome === 'H' ? 'W' : outcome === 'D' ? 'D' : 'L');
    if (hData.recent.length > 5) hData.recent.shift();

    aData.gf_total += estAwayGoals;
    aData.ga_total += estHomeGoals;
    aData.gp++;
    aData.recent.push(outcome === 'A' ? 'W' : outcome === 'D' ? 'D' : 'L');
    if (aData.recent.length > 5) aData.recent.shift();

    hData.matches_played.push({ date: m.matchDate, opponentElo: m.awayTeam.eloRating, result: hg });
    aData.matches_played.push({ date: m.matchDate, opponentElo: m.homeTeam.eloRating, result: ag });
  }

  // 3. Compute final stats
  const allTeams = await prisma.team.findMany();
  const computed = new Map<string, TeamStatsComputed>();

  for (const team of allTeams) {
    const data = teamMap.get(team.id);
    if (!data || data.gp === 0) {
      computed.set(team.id, { gf: 1.3, ga: 1.3, form: 0.5, elo: team.eloRating });
      continue;
    }

    const gf = data.gf_total / data.gp;
    const ga = data.ga_total / data.gp;

    // Form: weighted recent results (newer = higher weight)
    const weights = [0.1, 0.15, 0.2, 0.25, 0.3];
    let formScore = 0;
    const recent5 = data.recent.slice(-5);
    for (let i = 0; i < recent5.length; i++) {
      const pts = recent5[i] === 'W' ? 3 : recent5[i] === 'D' ? 1 : 0;
      formScore += pts * weights[i];
    }
    const maxForm = recent5.length > 0
      ? weights.slice(0, recent5.length).reduce((s, w) => s + w * 3, 0)
      : 1;
    const form = maxForm > 0 ? formScore / maxForm : 0.5;

    // Simple ELO from results
    const elo = team.eloRating;

    computed.set(team.id, { gf, ga, form, elo });
  }

  // 4. Update TeamStats
  console.log('💾 更新球队统计...');
  let statsUpdated = 0;
  for (const [teamId, stats] of computed) {
    await prisma.teamStats.deleteMany({ where: { teamId } });
    await prisma.teamStats.create({
      data: {
        id: `s_${teamId}`,
        teamId,
        matchDate: new Date(),
        expectedGoalsFor: parseFloat(stats.gf.toFixed(2)),
        expectedGoalsAgst: parseFloat(stats.ga.toFixed(2)),
        formScore: parseFloat(stats.form.toFixed(2)),
      },
    });
    await prisma.team.update({
      where: { id: teamId },
      data: { eloRating: stats.elo },
    });
    statsUpdated++;
  }
  console.log(`   ✅ ${statsUpdated} 队统计已更新`);

  // 5. Generate odds for matches without them
  console.log('🎰 为比赛生成赔率...');
  const matchesWithoutOdds = await prisma.match.findMany({
    where: { odds: { none: {} }, status: 'completed' },
    include: { homeTeam: true, awayTeam: true },
  });

  let oddsGenerated = 0;
  for (const m of matchesWithoutOdds) {
    // ELO-based odds estimation
    const eloDiff = m.homeTeam.eloRating - m.awayTeam.eloRating;
    const homeStrength = 1 / (1 + Math.exp(-eloDiff / 400));
    const drawProb = 0.27 - Math.abs(eloDiff) / 3000; // draw prob decreases with elo gap
    const homeProb = homeStrength * (1 - drawProb);
    const awayProb = (1 - homeStrength) * (1 - drawProb);

    // Convert probabilities to decimal odds (with margin)
    const margin = 1.08;
    const homeOdds = parseFloat((margin / Math.max(homeProb, 0.05)).toFixed(2));
    const drawOdds = parseFloat((margin / Math.max(drawProb, 0.05)).toFixed(2));
    const awayOdds = parseFloat((margin / Math.max(awayProb, 0.05)).toFixed(2));

    await prisma.odds.create({
      data: {
        id: `o_${m.id}`,
        matchId: m.id,
        currentHomeOdds: homeOdds,
        currentDrawOdds: drawOdds,
        currentAwayOdds: awayOdds,
      },
    });
    oddsGenerated++;
  }
  console.log(`   ✅ ${oddsGenerated} 组赔率已生成 (ELO-based)`);

  // 6. Summary
  const finalTeams = await prisma.team.count();
  const finalMatches = await prisma.match.count();
  const finalPredictions = await prisma.predictionHistory.count({
    where: { actualOutcome: { not: null } },
  });
  const finalOdds = await prisma.odds.count();

  console.log(`\n${'='.repeat(40)}`);
  console.log(`✅ Enrich 完成!`);
  console.log(`   ${finalTeams} 队 · ${finalMatches} 场 · ${finalOdds} 组赔率 · ${finalPredictions} 条预测记录`);
  console.log(`   ${'='.repeat(40)}`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => {
    console.error('❌', e);
    await prisma.$disconnect();
    process.exit(1);
  });
