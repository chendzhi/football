import express from 'express';
import prisma from './db';
import { autoSync } from './auto-sync';
import matchesRouter from './routes/matches';
import predictRouter from './routes/predict';
import evaluateRouter from './routes/evaluate';
import trainRouter from './routes/train';
import backtestRouter from './routes/backtest';
import dataSyncRouter from './routes/dataSync';
import adminRouter from './routes/admin';

const app = express();
const port = 3000;
const SYNC_INTERVAL_MIN = 30;

app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  next();
});

app.use('/api', matchesRouter);
app.use('/api', predictRouter);
app.use('/api', evaluateRouter);
app.use('/api', trainRouter);
app.use('/api', backtestRouter);
app.use('/api', dataSyncRouter);
app.use('/api', adminRouter);

// Manual trigger endpoint
app.post('/api/sync', async (_req, res) => {
  const log = await autoSync(prisma);
  res.json({ status: 'ok', log: log.split('\n') });
});

// Status endpoint
app.get('/api/sync/status', (_req, res) => {
  const completed = prisma.$queryRaw`SELECT COUNT(*) FROM Match WHERE status='completed'`;
  res.json({ intervalMin: SYNC_INTERVAL_MIN, message: `Auto-sync every ${SYNC_INTERVAL_MIN} min` });
});

app.listen(port, async () => {
  console.log(`>> [BACKEND] API listening on http://localhost:${port}`);
  console.log(`>> [AUTO-SYNC] every ${SYNC_INTERVAL_MIN} min | POST /api/sync to trigger`);

  // Initial sync
  try {
    const log = await autoSync(prisma);
    console.log('>> [AUTO-SYNC] initial:', log.split('\n')[0]);
  } catch (e: any) {
    console.log('>> [AUTO-SYNC] initial failed:', e.message);
  }

  // Recurring sync
  setInterval(async () => {
    try {
      const log = await autoSync(prisma);
      console.log('>> [AUTO-SYNC]', log.split('\n')[0]);
    } catch (e: any) {
      console.log('>> [AUTO-SYNC] failed:', e.message);
    }
  }, SYNC_INTERVAL_MIN * 60 * 1000);
});
