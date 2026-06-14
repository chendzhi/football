import { Router } from 'express';
import prisma from '../db';
import { runCalibration } from '../calibration/calibration';

const router = Router();

router.get('/evaluate', async (_req, res) => {
  try {
    const report = await runCalibration(prisma);
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: 'Failed to run calibration' });
  }
});

export default router;
