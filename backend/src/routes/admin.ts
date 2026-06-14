import { Router } from 'express';
import prisma from '../db';
import { eloUpdate, eloExpected } from '../feature';

const router = Router();

// Quick score update
router.post('/admin/score', async (req, res) => {
  try {
    const { matchId, homeScore, awayScore } = req.body;
    if (!matchId || homeScore === undefined || awayScore === undefined) {
      return res.status(400).json({ error: 'matchId, homeScore, awayScore required' });
    }

    const m = await prisma.match.findUnique({ where: { id: matchId }, include: { homeTeam: true, awayTeam: true } });
    if (!m) return res.status(404).json({ error: 'Match not found' });

    const hs = parseInt(homeScore), as = parseInt(awayScore);
    await prisma.match.update({ where: { id: matchId }, data: { homeScore: hs, awayScore: as, status: 'completed' } });

    // Update ELO
    const exp = eloExpected(m.homeTeam.eloRating, m.awayTeam.eloRating);
    const act = hs > as ? 1 : hs < as ? 0 : 0.5;
    await prisma.team.update({ where: { id: m.homeTeamId }, data: { eloRating: eloUpdate(m.homeTeam.eloRating, exp, act) } });
    await prisma.team.update({ where: { id: m.awayTeamId }, data: { eloRating: eloUpdate(m.awayTeam.eloRating, 1 - exp, 1 - act) } });

    const outcome = act === 1 ? 'H' : act === 0 ? 'A' : 'D';
    await prisma.predictionHistory.upsert({
      where: { id: `admin_ph_${matchId}` },
      update: { actualOutcome: outcome },
      create: { id: `admin_ph_${matchId}`, matchId, teamId: m.homeTeamId, predHomeWin: 0.4, predDraw: 0.3, predAwayWin: 0.3, actualOutcome: outcome, featureVersion: 'admin', modelVersion: 'v3', simulationVersion: 'v4' },
    });

    res.json({ ok: true, match: `${m.homeTeam.name} ${hs}:${as} ${m.awayTeam.name}`, newHomeElo: eloUpdate(m.homeTeam.eloRating, exp, act) });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// List matches needing scores (completed but no score)
router.get('/admin/pending', async (_req, res) => {
  const pending = await prisma.match.findMany({
    where: { status: 'scheduled', matchDate: { lt: new Date() } },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { matchDate: 'asc' },
  });
  res.json(pending.map(m => ({
    id: m.id, date: m.matchDate,
    home: m.homeTeam.shortName, away: m.awayTeam.shortName,
    group: m.groupName,
  })));
});

export default router;
