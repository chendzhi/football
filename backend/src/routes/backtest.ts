import { Router } from 'express';
import prisma from '../db';
import { runFullBacktest } from '../backtest/backtestEngine';

const router = Router();

router.get('/backtest', async (req, res) => {
  try {
    const matchId = req.query.matchId as string | undefined;
    const report = await runFullBacktest(prisma, matchId);
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: 'Backtest failed: ' + error.message });
  }
});

export default router;
