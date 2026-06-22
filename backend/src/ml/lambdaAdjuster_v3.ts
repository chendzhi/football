/**
 * Lambda Adjuster V3 — Log-Link GLM 对数线性建模
 *
 * 核心变更: 乘法连乘 → 对数空间增量叠加
 *   ln(λ) = ln(base_λ) + Σ w_i · ln(factor_i)
 *   λ = exp(ln(λ))
 *
 * 优势:
 *   - 因子间互相约束，单一极端因子不会主导结果
 *   - 权重可通过时序交叉验证训练
 *   - λ 永远 > 0，无需 clamp
 *   - 数学适配泊松分布指数族假设
 */

import type { RollingStats, SeparatedStats, H2HDetail, QualificationPressure } from './advancedFeatures';
import type { TravelData, TournamentContext, ScheduleDensity, RefereeImpact, CardSuspension, MatchEventData } from '../data/matchDataScraper';
import type { MatchWeather } from '../data/weatherScraper';

export interface LogLinearFactor {
  name: string;
  category: string;
  logValue: number;       // ln(factor) — 因子在对数空间的贡献
  weight: number;         // 可训练权重
  weightedLog: number;    // w_i · ln(factor_i)
  reason: string;
}

export interface LogLinearAdjustment {
  homeLogLambda: number;   // ln(adjusted λ_home)
  awayLogLambda: number;   // ln(adjusted λ_away)
  homeMultiplier: number;  // exp(homeLogLambda) / exp(ln(base))
  awayMultiplier: number;
  factors: LogLinearFactor[];
  totalLogAdjustment: { home: number; away: number };
}

// ─── 默认可训练权重 ───
// 这些权重可随时间序列交叉验证迭代优化
const DEFAULT_WEIGHTS = {
  travel: 0.8,          // 长途飞行影响
  suspension: 1.2,      // 伤病停赛 (高权重 — 直接缺人)
  pressure: 0.7,        // 出线压力
  knockout: 0.6,        // 淘汰赛保守
  collusion: 0.9,       // 默契球
  altitude: 0.7,        // 高原
  weather: 0.5,         // 天气
  referee: 0.3,         // 裁判
  defense: 0.9,         // 防守形态
  cleanSheet: 0.6,      // 零封率
  h2h: 0.5,             // H2H心理
  formation: 0.3,       // 阵型
  psych: 1.0,           // 心理冲击 (高权重)
  streak: 0.7,          // 势头
  schedule: 0.6,        // 赛程密集
  groupMatch3: 0.5,     // 第三轮慢热
  homeForm: 0.4,        // 主场形态
  topScorer: 1.3,       // 射手缺阵 (最高权重)
  stageWeight: 0.5,     // 赛事权重
};

const CLAMP = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 安全 ln: 永远返回有限值 */
function safeLog(x: number): number {
  return Math.log(CLAMP(x, 0.01, 100));
}

export function computeLogLinearAdjustment(params: {
  homeRolling: RollingStats;
  awayRolling: RollingStats;
  homeSep: SeparatedStats;
  awaySep: SeparatedStats;
  h2h: H2HDetail;
  homePressure: QualificationPressure;
  awayPressure: QualificationPressure;
  isKnockout: boolean;
  isHome: boolean;
  travel: TravelData;
  tournament: TournamentContext;
  schedule: ScheduleDensity;
  referee: RefereeImpact;
  suspensions: CardSuspension;
  weather: MatchWeather | null;
  altitude: number;
  matchEvents: MatchEventData | null;
  homeTopScorerMissing: boolean;
  awayTopScorerMissing: boolean;
  homeTopScorerGoals: number;
  awayTopScorerGoals: number;
}): LogLinearAdjustment {
  const W = DEFAULT_WEIGHTS;
  const factors: LogLinearFactor[] = [];
  let homeLogSum = 0;
  let awayLogSum = 0;

  const addFactor = (
    name: string, category: string, logValHome: number, logValAway: number,
    weight: number, reason: string
  ) => {
    const wh = logValHome * weight;
    const wa = logValAway * weight;
    homeLogSum += wh;
    awayLogSum += wa;
    factors.push({
      name, category,
      logValue: parseFloat(logValHome.toFixed(4)),
      weight,
      weightedLog: parseFloat(wh.toFixed(4)),
      reason,
    });
  };

  // ═══════════════════════════════════════
  // 一、阵容 & 球员
  // ═══════════════════════════════════════

  // 1a. 长途飞行 → ln(1-fatigue*0.2)
  {
    const hFatigue = params.travel.homeTravelFatigue;
    const aFatigue = params.travel.awayTravelFatigue;
    const hVal = safeLog(1 - hFatigue * 0.2);
    const aVal = safeLog(1 - aFatigue * 0.2);
    if (hFatigue > 0.05 || aFatigue > 0.05) {
      addFactor('长途飞行', '阵容', hVal, aVal, W.travel,
        `主${params.travel.homeDistanceKm}km/时差${params.travel.homeJetLag}h 客${params.travel.awayDistanceKm}km`);
    }
  }

  // 1b. 伤病/停赛
  {
    const hImpact = params.suspensions.homeImpact;
    const aImpact = params.suspensions.awayImpact;
    if (hImpact > 0 || aImpact > 0) {
      addFactor('伤病停赛', '阵容',
        safeLog(1 - hImpact * 1.5), safeLog(1 - aImpact * 1.5), W.suspension,
        `主缺${params.suspensions.homeMissing.join(',') || '无'} 客缺${params.suspensions.awayMissing.join(',') || '无'}`);
    }
  }

  // 1c. 射手缺阵 (最高优先级)
  if (params.homeTopScorerMissing) {
    addFactor('射手缺阵', '阵容',
      safeLog(0.85), 0, W.topScorer,
      `主队射手(${params.homeTopScorerGoals}球)缺阵 → λ -15%`);
  }
  if (params.awayTopScorerMissing) {
    addFactor('射手缺阵', '阵容',
      0, safeLog(0.85), W.topScorer,
      `客队射手(${params.awayTopScorerGoals}球)缺阵 → λ -15%`);
  }

  // ═══════════════════════════════════════
  // 二、赛制 & 战意
  // ═══════════════════════════════════════

  // 2a. 赛事权重
  if (params.tournament.stageWeight > 1.05) {
    const adj = safeLog(1 - (params.tournament.stageWeight - 1) * 0.15);
    addFactor('赛事权重', '赛制', adj, adj, W.stageWeight,
      `${params.tournament.stageWeight >= 1.3 ? '决赛/半决赛' : '淘汰赛'} → 谨慎`);
  }

  // 2b. 出线压力
  {
    const hP = params.homePressure.pressureScore;
    const aP = params.awayPressure.pressureScore;
    addFactor('出线压力', '赛制',
      safeLog(1 + (hP - 0.5) * 0.25), safeLog(1 + (aP - 0.5) * 0.25), W.pressure,
      `主${params.homePressure.mustWin ? '必须赢' : params.homePressure.alreadyQualified ? '已出线' : '一般'} 客${params.awayPressure.mustWin ? '必须赢' : '一般'}`);
  }

  // 2c. 淘汰赛
  if (params.tournament.isKnockout) {
    addFactor('淘汰赛保守', '赛制', safeLog(0.90), safeLog(0.90), W.knockout,
      '单场淘汰 → 双方保守');
  }

  // 2d. 默契球
  if (params.tournament.collusionPossible) {
    addFactor('默契球预警', '赛制', safeLog(0.85), safeLog(0.85), W.collusion,
      '积分净胜球接近，平局有利双方');
  }

  // ═══════════════════════════════════════
  // 三、场地 & 环境
  // ═══════════════════════════════════════

  // 3a. 高原
  if (params.altitude > 1500) {
    addFactor('高原主场', '场地', safeLog(1.06), 0, W.altitude,
      `${params.altitude}m → 主队心肺适应 +6%`);
  }

  // 3b. 天气
  if (params.weather) {
    const w = params.weather;
    if (w.isExtremeHeat) {
      addFactor('高温', '场地', safeLog(0.92), safeLog(0.92), W.weather, `${w.temperature}°C`);
    }
    if (w.isRain) {
      addFactor('降雨', '场地', safeLog(0.93), safeLog(0.93), W.weather, `${w.precipitation}mm`);
    }
    if (w.windSpeed > 30) {
      addFactor('强风', '场地', safeLog(0.95), safeLog(0.95), W.weather, `${w.windSpeed}km/h`);
    }
  }

  // 3c. 裁判
  if (params.referee.goalImpact !== 1.0) {
    addFactor('裁判尺度', '场地', safeLog(params.referee.goalImpact), safeLog(params.referee.goalImpact),
      W.referee, `${params.referee.name} strictness=${params.referee.strictness}`);
  }

  // ═══════════════════════════════════════
  // 四、战术 & 交锋
  // ═══════════════════════════════════════

  // 4a. 防守形态
  {
    const hDef = params.homeRolling.n > 0 ? params.homeRolling.ga : 1.2;
    const aDef = params.awayRolling.n > 0 ? params.awayRolling.ga : 1.2;
    // 好防守 → 对手 λ 降低; 差防守 → 对手 λ 升高
    addFactor('防守形态', '战术',
      safeLog(1 + (1.2 - aDef) * 0.25), safeLog(1 + (1.2 - hDef) * 0.25), W.defense,
      `主失${hDef.toFixed(2)}/场 客失${aDef.toFixed(2)}/场`);
  }

  // 4b. 零封率
  {
    const hCS = params.homeRolling.cleanSheets;
    const aCS = params.awayRolling.cleanSheets;
    addFactor('零封率', '战术',
      safeLog(1 + (aCS - 0.2) * 0.2), safeLog(1 + (hCS - 0.2) * 0.2), W.cleanSheet,
      `主${(hCS*100).toFixed(0)}% 客${(aCS*100).toFixed(0)}%`);
  }

  // 4c. H2H 心理
  if (params.h2h.meetings >= 2) {
    const avgGD = params.h2h.goalDiff / params.h2h.meetings;
    addFactor('H2H心理', '战术',
      safeLog(1 + avgGD * 0.04), safeLog(1 - avgGD * 0.04), W.h2h,
      `近${params.h2h.meetings}场${params.h2h.last3Results} 净胜${params.h2h.goalDiff > 0 ? '+' : ''}${params.h2h.goalDiff}`);
  }

  // ═══════════════════════════════════════
  // 五、赛程 & 体能
  // ═══════════════════════════════════════

  // 5a. 心理冲击
  {
    const hPsych = params.homeRolling.lastGoalDiff;
    const aPsych = params.awayRolling.lastGoalDiff;
    const hVal = hPsych <= -3 ? safeLog(0.88) : hPsych >= 3 ? safeLog(1.08) : 0;
    const aVal = aPsych <= -3 ? safeLog(0.88) : aPsych >= 3 ? safeLog(1.08) : 0;
    if (hVal !== 0 || aVal !== 0) {
      addFactor('心理冲击', '体能', hVal, aVal, W.psych,
        `主上一场${hPsych > 0 ? '+' : ''}${hPsych} 客${aPsych > 0 ? '+' : ''}${aPsych}${hPsych <= -3 ? '(惨败)' : ''}${aPsych <= -3 ? '(惨败)' : ''}`);
    }
  }

  // 5b. 势头
  {
    const hStreak = params.homeRolling.unbeatenStreak - params.homeRolling.losingStreak;
    const aStreak = params.awayRolling.unbeatenStreak - params.awayRolling.losingStreak;
    if (Math.abs(hStreak) >= 2 || Math.abs(aStreak) >= 2) {
      addFactor('势头', '体能',
        safeLog(1 + hStreak * 0.03), safeLog(1 + aStreak * 0.03), W.streak,
        `主${hStreak >= 0 ? '不败' : '连败'}${Math.abs(hStreak)}场 客${aStreak >= 0 ? '不败' : '连败'}${Math.abs(aStreak)}场`);
    }
  }

  // 5c. 赛程密集
  {
    const hFat = params.schedule.homeFatigueScore;
    const aFat = params.schedule.awayFatigueScore;
    if (hFat > 0 || aFat > 0) {
      addFactor('赛程密集', '体能',
        safeLog(1 - hFat * 1.5), safeLog(1 - aFat * 1.5), W.schedule,
        `主${params.schedule.homeDaysSinceLast}天前${params.schedule.homeMatch3in7 ? ' 7天3赛!' : ''} 客${params.schedule.awayDaysSinceLast}天前`);
    }
  }

  // 5d. 小组第三轮
  if (params.tournament.isGroupMatch3) {
    addFactor('第三轮慢热', '体能', safeLog(0.94), safeLog(0.94), W.groupMatch3,
      '小组收官战进攻欲望下降');
  }

  // 5e. 主场形态
  if (params.isHome) {
    const hgf = params.homeSep.homeGF, hga = params.homeSep.homeGA;
    const agf = params.awaySep.awayGF, aga = params.awaySep.awayGA;
    const venueAdv = (hgf - hga) - (agf - aga);
    if (Math.abs(venueAdv) > 0.2) {
      addFactor('主场形态', '体能',
        safeLog(1 + venueAdv * 0.06), 0, W.homeForm,
        `主主场${hgf.toFixed(1)}-${hga.toFixed(1)} 客客场${agf.toFixed(1)}-${aga.toFixed(1)}`);
    }
  }

  // ── 全局软约束: 对数空间自然约束, 无需硬 clamp ──
  // tanh 软饱和: 防止极端累积
  const softSaturate = (x: number): number => {
    // tanh(x/0.5) 在 ±0.35 范围内几近线性, 超出后逐渐饱和到 ±1
    return Math.tanh(x / 0.35) * 0.35;
  };

  const homeLogAdjustment = softSaturate(homeLogSum);
  const awayLogAdjustment = softSaturate(awayLogSum);

  return {
    homeLogLambda: parseFloat(homeLogAdjustment.toFixed(4)),
    awayLogLambda: parseFloat(awayLogAdjustment.toFixed(4)),
    homeMultiplier: parseFloat(Math.exp(homeLogAdjustment).toFixed(4)),
    awayMultiplier: parseFloat(Math.exp(awayLogAdjustment).toFixed(4)),
    factors,
    totalLogAdjustment: {
      home: parseFloat(homeLogSum.toFixed(4)),
      away: parseFloat(awayLogSum.toFixed(4)),
    },
  };
}
