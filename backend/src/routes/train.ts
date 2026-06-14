import { Router } from 'express';
import prisma from '../db';
import { eloUpdate, eloExpected, getTeamGoalStats } from '../feature';

const router = Router();

// Recalculate ELO for all teams based on completed match results
router.post('/train', async (_req, res) => {
  try {
    const completed = await prisma.match.findMany({
      where: { status: 'completed', homeScore: { not: null }, awayScore: { not: null } },
      include: { homeTeam: true, awayTeam: true },
    });

    if (completed.length === 0) {
      return res.json({ message: 'No completed matches to train on', updated: 0 });
    }

    let updated = 0;
    for (const m of completed) {
      const homeElo = m.homeTeam.eloRating;
      const awayElo = m.awayTeam.eloRating;
      const expected = eloExpected(homeElo, awayElo);
      const actual = m.homeScore! > m.awayScore! ? 1 : m.homeScore! < m.awayScore! ? 0 : 0.5;

      const newHomeElo = eloUpdate(homeElo, expected, actual, 20);
      const newAwayElo = eloUpdate(awayElo, 1 - expected, 1 - actual, 20);

      await prisma.team.update({ where: { id: m.homeTeamId }, data: { eloRating: newHomeElo } });
      await prisma.team.update({ where: { id: m.awayTeamId }, data: { eloRating: newAwayElo } });
      updated += 2;
    }

    res.json({ message: `ELO updated for ${updated} teams from ${completed.length} matches`, updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
