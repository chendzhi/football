/**
 * Error Analyzer — 找出模型哪里高估/低估
 *
 * 核心问题：
 *   模型在 50-70% 区间的预测，实际命中率是 59% 还是 71%？
 */

import { PredictionRecord } from './backtestEngine';

export interface ErrorBucket {
  bin: string;
  avgPred: number;
  avgActual: number;
  bias: number;   // positive = overconfident, negative = underconfident
  count: number;
}

export interface ErrorAnalysis {
  buckets: ErrorBucket[];
  overconfidentBins: string[];   // 模型太乐观
  underconfidentBins: string[];  // 模型太保守
  summary: string;
}

const BUCKET_DEFS: Array<{ label: string; min: number; max: number }> = [
  { label: '0-10%',   min: 0,   max: 0.1 },
  { label: '10-30%',  min: 0.1, max: 0.3 },
  { label: '30-50%',  min: 0.3, max: 0.5 },
  { label: '50-70%',  min: 0.5, max: 0.7 },
  { label: '70-90%',  min: 0.7, max: 0.9 },
  { label: '90-100%', min: 0.9, max: 1.0 },
];

function getBucket(p: number): string {
  for (const b of BUCKET_DEFS) {
    if (p >= b.min && p < b.max) return b.label;
  }
  return '90-100%';
}

export function analyzeError(records: PredictionRecord[]): ErrorAnalysis {
  const buckets: Record<string, { predSum: number; actualSum: number; count: number }> = {};

  for (const b of BUCKET_DEFS) {
    buckets[b.label] = { predSum: 0, actualSum: 0, count: 0 };
  }

  for (const r of records) {
    const bin = getBucket(r.predictedHomeWin);
    buckets[bin].predSum += r.predictedHomeWin;
    const isHome = r.actualResult === 'HOME' || r.actualResult === 'H';
    buckets[bin].actualSum += isHome ? 1 : 0;
    buckets[bin].count++;
  }

  const result: ErrorBucket[] = [];
  const overconfident: string[] = [];
  const underconfident: string[] = [];

  for (const b of BUCKET_DEFS) {
    const v = buckets[b.label];
    if (v.count === 0) continue;

    const avgPred = v.predSum / v.count;
    const avgActual = v.actualSum / v.count;
    const bias = avgPred - avgActual;

    if (bias > 0.05) overconfident.push(b.label);
    else if (bias < -0.05) underconfident.push(b.label);

    result.push({
      bin: b.label,
      avgPred: parseFloat(avgPred.toFixed(3)),
      avgActual: parseFloat(avgActual.toFixed(3)),
      bias: parseFloat(bias.toFixed(3)),
      count: v.count,
    });
  }

  let summary = '校准良好';
  if (overconfident.length > 0 && underconfident.length > 0) {
    summary = `高估区间: ${overconfident.join(', ')} | 低估区间: ${underconfident.join(', ')}`;
  } else if (overconfident.length > 0) {
    summary = `整体偏乐观，高估区间: ${overconfident.join(', ')}`;
  } else if (underconfident.length > 0) {
    summary = `整体偏保守，低估区间: ${underconfident.join(', ')}`;
  }

  return { buckets: result, overconfidentBins: overconfident, underconfidentBins: underconfident, summary };
}
