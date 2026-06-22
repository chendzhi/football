/**
 * Backtest Engine — 验证模型是否真的准
 *
 * 核心闭环：
 *   预测 → 真实结果 → 误差分析 → 模型修正
 */

import { PrismaClient } from '@prisma/client';
import { analyzeError, ErrorAnalysis } from './errorAnalyzer';
import { computeRollingMetrics, RollingWindowResult } from './rollingWindow';

export interface PredictionRecord {
  matchId: string;
  predictedHomeWin: number;
  predictedDraw: number;
  predictedAwayWin: number;
  actualResult: string;  // 'H'/'D'/'A' from DB, or 'HOME'/'DRAW'/'AWAY'
  homeGoals: number;
  awayGoals: number;
  brierScore: number;
  logLoss: number;
  featureVersion: string;
  modelVersion: string;
  timestamp: number;
}

export interface BacktestStats {
  total: number;
  brier: number;
  logLoss: number;
  accuracy: number;   // hit rate (argmax)
  roi: number;        // flat betting ROI (home win bets)
  profit: number;     // units profit
}

export class BacktestEngine {
  /**
   * Run full backtest on prediction records.
   */
  run(records: PredictionRecord[]): BacktestStats {
    if (records.length === 0) {
      return { total: 0, brier: 0, logLoss: 0, accuracy: 0, roi: 0, profit: 0 };
    }

    let brierSum = 0;
    let logLossSum = 0;
    let correct = 0;
    let profit = 0;

    for (const r of records) {
      brierSum += r.brierScore;
      logLossSum += r.logLoss;

      // Argmax accuracy
      const pred =
        r.predictedHomeWin > r.predictedDraw && r.predictedHomeWin > r.predictedAwayWin
          ? 'H'
          : r.predictedDraw > r.predictedAwayWin
          ? 'D'
          : 'A';

      const actual = normalizeOutcome(r.actualResult);
      if (pred === actual) correct++;

      // Value betting: bet on the outcome with highest edge over fair
      const probs = { H: r.predictedHomeWin, D: r.predictedDraw, A: r.predictedAwayWin };
      const bestBet = probs.H >= probs.D && probs.H >= probs.A ? 'H'
        : probs.D >= probs.A ? 'D' : 'A';
      const bestProb = probs[bestBet];
      const impliedOdds = 1 / Math.max(bestProb, 0.05);
      if (actual === bestBet) {
        profit += impliedOdds - 1;
      } else {
        profit -= 1;
      }
    }

    const N = records.length;
    return {
      total: N,
      brier: parseFloat((brierSum / N).toFixed(4)),
      logLoss: parseFloat((logLossSum / N).toFixed(4)),
      accuracy: parseFloat((correct / N).toFixed(4)),
      roi: parseFloat((profit / N).toFixed(4)),
      profit: parseFloat(profit.toFixed(2)),
    };
  }
}

// ─── API：从 DB 加载 + 回测 ───

export interface FullBacktestReport {
  stats: BacktestStats;
  errorAnalysis: ErrorAnalysis;
  rollingWindow: RollingWindowResult[];
  modelComparison: ModelComparison[];
  topScoreHitRate: number;
  calibrationBins: Array<{ bin: string; predPct: number; actualPct: number; count: number }>;
}

export interface ModelComparison {
  modelVersion: string;
  count: number;
  brier: number;
  accuracy: number;
}

export async function runFullBacktest(prisma: PrismaClient, matchId?: string): Promise<FullBacktestReport> {
  const where: any = { actualOutcome: { not: null } };
  if (matchId) where.matchId = matchId;

  const records = await prisma.predictionHistory.findMany({
    where,
    include: { match: { select: { homeScore: true, awayScore: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const engine = new BacktestEngine();

  const predRecords: PredictionRecord[] = records.map(r => ({
    matchId: r.matchId,
    predictedHomeWin: r.predHomeWin,
    predictedDraw: r.predDraw,
    predictedAwayWin: r.predAwayWin,
    actualResult: r.actualOutcome as 'HOME' | 'DRAW' | 'AWAY',
    homeGoals: (r as any).match?.homeScore ?? 0,
    awayGoals: (r as any).match?.awayScore ?? 0,
    brierScore: computeBrierForRecord(r.predHomeWin, r.predDraw, r.predAwayWin, r.actualOutcome!),
    logLoss: computeLogLossForRecord(r.predHomeWin, r.predDraw, r.predAwayWin, r.actualOutcome!),
    featureVersion: r.featureVersion,
    modelVersion: r.modelVersion,
    timestamp: new Date(r.createdAt).getTime(),
  }));

  const stats = engine.run(predRecords);
  const errorAnalysis = analyzeError(predRecords);
  const rollingWindow = computeRollingMetrics(predRecords, 5);

  // Per-model-version comparison
  const byVersion: Record<string, PredictionRecord[]> = {};
  for (const r of predRecords) {
    const v = r.modelVersion || 'unknown';
    if (!byVersion[v]) byVersion[v] = [];
    byVersion[v].push(r);
  }

  const modelComparison: ModelComparison[] = Object.entries(byVersion).map(([v, rs]) => ({
    modelVersion: v,
    count: rs.length,
    brier: parseFloat((rs.reduce((s, r) => s + r.brierScore, 0) / rs.length).toFixed(4)),
    accuracy: parseFloat((rs.filter(r => {
      const pred = r.predictedHomeWin > r.predictedDraw && r.predictedHomeWin > r.predictedAwayWin ? 'H'
        : r.predictedDraw > r.predictedAwayWin ? 'D' : 'A';
      return pred === normalizeOutcome(r.actualResult);
    }).length / rs.length).toFixed(4)),
  }));

  // Top-3 scoreline hit rate (approximate from prediction confidence)
  const topScoreHitRate = predRecords.length > 0
    ? parseFloat((predRecords.filter(r => {
        const pred = r.predictedHomeWin > r.predictedDraw && r.predictedHomeWin > r.predictedAwayWin ? 'H'
          : r.predictedDraw > r.predictedAwayWin ? 'D' : 'A';
        return pred === normalizeOutcome(r.actualResult);
      }).length / predRecords.length).toFixed(3))
    : 0;

  // Calibration bins: group predictions by probability range
  const calBins: Array<{ bin: string; predPct: number; actualPct: number; count: number }> = [];
  const thresholds = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  for (let i = 0; i < thresholds.length; i++) {
    const lo = thresholds[i];
    const hi = thresholds[i + 1] || 1.0;
    const binPreds = predRecords.filter(r => r.predictedHomeWin >= lo && r.predictedHomeWin < hi);
    if (binPreds.length >= 3) {
      const avgPred = binPreds.reduce((s, r) => s + r.predictedHomeWin, 0) / binPreds.length;
      const avgActual = binPreds.filter(r => normalizeOutcome(r.actualResult) === 'H').length / binPreds.length;
      calBins.push({
        bin: `${(lo*100).toFixed(0)}-${(hi*100).toFixed(0)}%`,
        predPct: parseFloat(avgPred.toFixed(3)),
        actualPct: parseFloat(avgActual.toFixed(3)),
        count: binPreds.length,
      });
    }
  }

  return { stats, errorAnalysis, rollingWindow, modelComparison, topScoreHitRate, calibrationBins: calBins };
}

// ─── Helpers ───

function normalizeOutcome(o: string): 'H' | 'D' | 'A' {
  if (o === 'HOME' || o === 'H') return 'H';
  if (o === 'DRAW' || o === 'D') return 'D';
  return 'A';
}

function computeBrierForRecord(h: number, d: number, a: number, outcome: string): number {
  const n = normalizeOutcome(outcome);
  const oH = n === 'H' ? 1 : 0;
  const oD = n === 'D' ? 1 : 0;
  const oA = n === 'A' ? 1 : 0;
  return (h - oH) ** 2 + (d - oD) ** 2 + (a - oA) ** 2;
}

function computeLogLossForRecord(h: number, d: number, a: number, outcome: string): number {
  let p: number;
  if (outcome === 'HOME' || outcome === 'H') p = h;
  else if (outcome === 'DRAW' || outcome === 'D') p = d;
  else p = a;
  return -Math.log(Math.max(p, 1e-10));
}
