/**
 * Poisson Matrix — 生成 Dixon-Coles 修正联合概率矩阵
 *
 * 复用现有 dixonColesTau() 对 (0,0)(1,0)(0,1)(1,1) 进行低比分相关性修正。
 */

import { dixonColesTau } from '../dixon_coles';

export interface PoissonMatrixResult {
  matrix: number[][];          // 6×6 联合概率 (0..5 球)
  displayMatrix: number[][];   // 5×5 展示用 (0..4 球)
  regionIndicators: string[][];// "home" | "draw" | "away" 每个格子
  homeMarginal: number[];      // 主队边缘分布 P(k), k=0..5
  awayMarginal: number[];      // 客队边缘分布 P(k), k=0..5
}

export interface PoissonDistribution {
  home: number[];  // P(0)..P(4) 展示用
  away: number[];  // P(0)..P(4) 展示用
}

/** 泊松概率质量函数: P(k; λ) = e^{-λ} * λ^k / k! */
function poissonProb(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(Math.max(lambda, 0.01));
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** 生成 6×6 Dixon-Coles 修正联合概率矩阵 */
export function generatePoissonMatrix(
  homeLambda: number,
  awayLambda: number,
  rho: number = -0.25
): PoissonMatrixResult {
  const size = 6;
  const matrix: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));

  // 未归一化联合概率 + Dixon-Coles 修正
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      const px = poissonProb(x, homeLambda);
      const py = poissonProb(y, awayLambda);
      const tau = dixonColesTau(x, y, homeLambda, awayLambda, rho);
      matrix[x][y] = px * py * tau;
    }
  }

  // 归一化
  const total = matrix.flat().reduce((a, b) => a + b, 0);
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      matrix[x][y] = parseFloat((matrix[x][y] / Math.max(total, 1e-12)).toFixed(6));
    }
  }

  // 5×5 展示矩阵
  const displayMatrix = matrix.slice(0, 5).map(row =>
    row.slice(0, 5).map(v => parseFloat(v.toFixed(4)))
  );

  // 区域标识: x > y → home win, x < y → away win, x === y → draw
  const regionIndicators: string[][] = Array.from({ length: 5 }, (_, x) =>
    Array.from({ length: 5 }, (_, y) => x > y ? 'home' : x < y ? 'away' : 'draw')
  );

  // 边缘分布
  const homeMarginal: number[] = Array.from({ length: size }, (_, x) =>
    parseFloat(matrix[x].reduce((a, b) => a + b, 0).toFixed(6))
  );
  const awayMarginal: number[] = Array.from({ length: size }, (_, y) =>
    parseFloat(matrix.reduce((a, row) => a + row[y], 0).toFixed(6))
  );

  return { matrix, displayMatrix, regionIndicators, homeMarginal, awayMarginal };
}

/** 生成两队 P(0)~P(4) 泊松分布 (用于展示 Poisson Active) */
export function generatePoissonDistribution(
  homeLambda: number,
  awayLambda: number
): PoissonDistribution {
  return {
    home: Array.from({ length: 5 }, (_, k) =>
      parseFloat(poissonProb(k, homeLambda).toFixed(6))),
    away: Array.from({ length: 5 }, (_, k) =>
      parseFloat(poissonProb(k, awayLambda).toFixed(6))),
  };
}
