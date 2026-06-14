import { Router } from 'express';
import prisma from '../db';
import { collectOdds } from '../data/collectors/oddsCollector';
import { buildTrainingDataset, datasetStats } from '../data/pipelines/datasetBuilder';

const router = Router();

/** Manual trigger: pull latest odds from sporttery.cn */
router.post('/data/collect-odds', async (_req, res) => {
  try {
    const count = await collectOdds(prisma);
    res.json({ snapshotsCollected: count, source: 'sporttery.cn' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Build training dataset from current DB state */
router.get('/data/dataset', async (_req, res) => {
  try {
    const ds = await buildTrainingDataset(prisma);
    res.json({
      stats: datasetStats(ds),
      trainCount: ds.train.length,
      testCount: ds.test.length,
      totalMatches: ds.totalMatches,
      withOdds: ds.withOdds,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** Auto-sync: collect odds + build features */
router.post('/data/sync-all', async (_req, res) => {
  try {
    const oddsSnapshots = await collectOdds(prisma);
    const ds = await buildTrainingDataset(prisma);
    res.json({
      oddsSnapshots,
      datasetStats: datasetStats(ds),
      trainReady: ds.train.length >= 10,
      nextStep: ds.train.length >= 10
        ? 'Run POST /api/train to update λ weights'
        : `Need ${10 - ds.train.length} more completed matches to enable training`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
