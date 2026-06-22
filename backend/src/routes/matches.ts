import { Router } from 'express';
import prisma from '../db';

const router = Router();

router.get('/matches', async (_req, res) => {
  try {
    // Only World Cup matches (exclude historical training data)
    const matches = await prisma.match.findMany({
      where: { stage: { not: 'HISTORICAL' } },
      include: { homeTeam: true, awayTeam: true },
      orderBy: { matchDate: 'asc' }
    });
    res.json(matches);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load matches' });
  }
});

export default router;
