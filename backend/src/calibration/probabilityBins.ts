/**
 * Probability Binning — 把连续概率离散化到 10 个区间
 */

export function getBin(p: number): string {
  if (p < 0.1) return '0-10%';
  if (p < 0.2) return '10-20%';
  if (p < 0.3) return '20-30%';
  if (p < 0.4) return '30-40%';
  if (p < 0.5) return '40-50%';
  if (p < 0.6) return '50-60%';
  if (p < 0.7) return '60-70%';
  if (p < 0.8) return '70-80%';
  if (p < 0.9) return '80-90%';
  return '90-100%';
}

export function getBinMidpoint(p: number): number {
  if (p < 0.1) return 0.05;
  if (p < 0.2) return 0.15;
  if (p < 0.3) return 0.25;
  if (p < 0.4) return 0.35;
  if (p < 0.5) return 0.45;
  if (p < 0.6) return 0.55;
  if (p < 0.7) return 0.65;
  if (p < 0.8) return 0.75;
  if (p < 0.9) return 0.85;
  return 0.95;
}

export const ALL_BINS = [
  '0-10%', '10-20%', '20-30%', '30-40%', '40-50%',
  '50-60%', '60-70%', '70-80%', '80-90%', '90-100%',
];
