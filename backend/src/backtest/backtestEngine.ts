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

      // Argmax accuracy (normalize outcome codes)
      const pred =
        r.predictedHomeWin > r.predictedDraw && r.predictedHomeWin > r.predictedAwayWin
          ? 'H'
          : r.predictedDraw > r.predictedAwayWin
          ? 'D'
          : 'A';

      const actual = normalizeOutcome(r.actualResult);
      if (pred === actual) correct++;

      // Flat betting ROI: bet 1 unit on home win
      const impliedOdds = 1 / Math.max(r.predictedHomeWin, 0.01);
      if (actual === 'H') {
        profit += impliedOdds - 1; // win
      } else {
        profit -= 1; // lose stake
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
}

export interface ModelComparison {
  modelVersion: string;
  count: number;
  brier: number;
  accuracy: number;
}

export async function runFullBacktest(prisma: PrismaClient): Promise<FullBacktestReport> {
  const records = await prisma.predictionHistory.findMany({
    where: { actualOutcome: { not: null } },
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

  return { stats, errorAnalysis, rollingWindow, modelComparison };
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
