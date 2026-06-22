import { Router } from 'express';
import prisma from '../db';
import { runDriftMonitor } from '../calibration/driftMonitor';

const router = Router();

router.get('/drift', async (_req, res) => {
  try {
    const report = await runDriftMonitor(prisma);
    res.json(report);
  } catch (error: any) {
    res.status(500).json({ error: 'Drift monitor failed: ' + error.message });
  }
});

export default router;
