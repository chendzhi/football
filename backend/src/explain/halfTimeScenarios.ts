/**
 * Half-Time Scenario Generator — 泊松半场推演
 *
 * 利用泊松过程的时间可加性: λ_HT = λ_FT / 2
 * 对半场概率矩阵取 Top 3 最可能半场比分，
 * 再从每个半场出发条件推算全场结果。
 */

import { dixonColesTau } from '../dixon_coles';

export interface HalfTimeScenario {
  halfScore: string;
  halfHome: number;
  halfAway: number;
  halfProb: number;
  fullScore: string;
  fullProb: number;
  ftOutcome: string;       // 'home' | 'away' | 'draw'
  narrative: string;       // "主战" | "僵持" | "冷门"
}

export interface HalfTimeScenariosResult {
  scenarios: HalfTimeScenario[];  // 3 条推演路径
  homeLambdaHT: number;
  awayLambdaHT: number;
}

/** 泊松概率 P(k; λ) */
function poissonProb(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let logP = -lambda + k * Math.log(Math.max(lambda, 0.01));
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/**
 * 生成 Top 3 半场比分 + 条件全场推演
 *
 * @param homeLambdaFT 全场主队 λ
 * @param awayLambdaFT 全场客队 λ
 * @param rho Dixon-Coles ρ 参数
 */
export function generateHalfTimeScenarios(
  homeLambdaFT: number,
  awayLambdaFT: number,
  rho: number = -0.25
): HalfTimeScenariosResult {
  // 半场 λ = 全场 λ / 2
  const homeLambdaHT = homeLambdaFT / 2;
  const awayLambdaHT = awayLambdaFT / 2;
  const homeLambda2H = homeLambdaFT / 2; // 下半场
  const awayLambda2H = awayLambdaFT / 2;

  // 枚举所有半场比分 (0..5 球)，计算概率
  const htCandidates: Array<{
    h: number; a: number;
    prob: number;
  }> = [];

  let htTotal = 0;
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      const ph = poissonProb(h, homeLambdaHT);
      const pa = poissonProb(a, awayLambdaHT);
      const tau = dixonColesTau(h, a, homeLambdaHT, awayLambdaHT, rho);
      const prob = ph * pa * tau;
      htCandidates.push({ h, a, prob });
      htTotal += prob;
    }
  }

  // 归一化
  for (const c of htCandidates) c.prob /= Math.max(htTotal, 1e-12);

  // 按概率降序取 Top 6（再去重逻辑取 3 条不同叙事线）
  htCandidates.sort((a, b) => b.prob - a.prob);

  // 找 3 条推演路径: 主队领先、平局、客队领先（各取最高概率的那个）
  const homeLead = htCandidates.find(c => c.h > c.a);
  const draw = htCandidates.find(c => c.h === c.a);
  const awayLead = htCandidates.find(c => c.h < c.a);

  const top3 = [homeLead, draw, awayLead].filter(Boolean) as typeof htCandidates;

  // 对每个半场比分，计算条件全场概率分布，取概率最高的 FT 比分
  // （不是最可能的半场追加，而是所有通向该 FT 比分的路径概率之和）
  const scenarios: HalfTimeScenario[] = top3.map(candidate => {
    // 条件全场概率: P(FT | HT) = P(2H增量)
    // 对每个可能的 FT 比分，累加所有 2H 路径概率
    const ftScoreMap = new Map<string, number>();
    let ftTotal = 0;

    for (let dh = 0; dh <= 5; dh++) {
      for (let da = 0; da <= 5; da++) {
        const ph = poissonProb(dh, homeLambda2H);
        const pa = poissonProb(da, awayLambda2H);
        const tau = dixonColesTau(dh, da, homeLambda2H, awayLambda2H, rho);
        const prob = ph * pa * tau;
        ftTotal += prob;
        const fh = candidate.h + dh;
        const fa = candidate.a + da;
        if (fh <= 5 && fa <= 5) {
          const key = `${fh}-${fa}`;
          ftScoreMap.set(key, (ftScoreMap.get(key) || 0) + prob);
        }
      }
    }

    // 找概率最高的 FT 比分
    let bestFull = { h: candidate.h, a: candidate.a, prob: 0 };
    for (const [key, prob] of ftScoreMap) {
      const normProb = prob / Math.max(ftTotal, 1e-12);
      if (normProb > bestFull.prob) {
        const [h, a] = key.split('-').map(Number);
        bestFull = { h, a, prob: normProb };
      }
    }

    // 叙事标签: 基于全场预测概率, 而非半场比分
    // expected winner path → 主战 / draw → 僵持 / underdog → 冷门
    const ftOutcome = bestFull.h > bestFull.a ? 'home' : bestFull.h < bestFull.a ? 'away' : 'draw';

    return {
      halfScore: `${candidate.h}-${candidate.a}`,
      halfHome: candidate.h,
      halfAway: candidate.a,
      halfProb: parseFloat(candidate.prob.toFixed(4)),
      fullScore: `${bestFull.h}-${bestFull.a}`,
      fullProb: parseFloat(bestFull.prob.toFixed(4)),
      ftOutcome,
      narrative: '', // filled below
    };
  });

  // 确定哪方是预期赢家: 计算全场胜平负概率
  const hWinProb = htCandidates.filter(c => c.h > c.a).reduce((s, c) => s + c.prob, 0);
  const aWinProb = htCandidates.filter(c => c.h < c.a).reduce((s, c) => s + c.prob, 0);
  const drawProb = htCandidates.filter(c => c.h === c.a).reduce((s, c) => s + c.prob, 0);

  // 为主/客/平分配叙事
  const expectedWinner = hWinProb > aWinProb ? 'home' : 'away';
  for (const s of scenarios as any[]) {
    if (s.ftOutcome === 'draw') {
      s.narrative = '僵持';
    } else if (s.ftOutcome === expectedWinner) {
      s.narrative = '主战';
    } else {
      s.narrative = '冷门';
    }
  }

  // 按叙事排序: 主战 → 僵持 → 冷门
  const order = { '主战': 0, '僵持': 1, '冷门': 2 };
  scenarios.sort((a, b) => (order[a.narrative as keyof typeof order] ?? 9) - (order[b.narrative as keyof typeof order] ?? 9));

  return {
    scenarios: scenarios.slice(0, 3),
    homeLambdaHT: parseFloat(homeLambdaHT.toFixed(4)),
    awayLambdaHT: parseFloat(awayLambdaHT.toFixed(4)),
  };
}
