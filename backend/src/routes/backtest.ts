import { Router } from 'express';
import prisma from '../db';
import { runFullBacktest } from '../backtest/backtestEngine';

const router = Router();

router.get('/backtest', async (_req, res) => {
  try {
    const report = await runFullBacktest(prisma);
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: 'Backtest failed: ' + error.message });
  }
});

export default router;
