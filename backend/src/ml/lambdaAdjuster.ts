/**
 * Lambda Adjuster V2 — 全量特征 → λ 修正系数
 *
 * 5大类特征: 阵容球员 / 赛制战意 / 场地天气 / 战术交锋 / 赛程体能
 * 每个因子 ±20% 封顶，组合 ±30% 总封顶
 */

import type { AdvancedFeatures, RollingStats, SeparatedStats, H2HDetail, QualificationPressure } from './advancedFeatures';
import type { TravelData, TournamentContext, ScheduleDensity, RefereeImpact, CardSuspension, MatchEventData } from '../data/matchDataScraper';
import type { MatchWeather } from '../data/weatherScraper';

export interface AdjustmentDetail {
  factor: string;
  homeAdj: number;
  awayAdj: number;
  reason: string;
  category: string;
}

export interface LambdaAdjustment {
  homeMultiplier: number;
  awayMultiplier: number;
  details: AdjustmentDetail[];
}

const CLAMP = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function computeFullLambdaAdjustment(params: {
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
}): LambdaAdjustment {
  const details: AdjustmentDetail[] = [];
  let homeMult = 1.0, awayMult = 1.0;

  // ═══════════════════════════════════════
  // 一、阵容 & 球员类
  // ═══════════════════════════════════════

  // 1a. 伤病/停赛影响
  {
    const hImpact = params.suspensions.homeImpact;
    const aImpact = params.suspensions.awayImpact;
    // 缺核心 → 进攻λ -10%~-20%
    const hAdj = CLAMP(1 - hImpact * 1.5, 0.85, 1.0);
    const aAdj = CLAMP(1 - aImpact * 1.5, 0.85, 1.0);
    homeMult *= hAdj;
    awayMult *= aAdj;
    if (hImpact > 0 || aImpact > 0) {
      details.push({
        factor: '伤病/停赛',
        homeAdj: hAdj, awayAdj: aAdj,
        reason: `主缺${params.suspensions.homeMissing.join(',') || '无'} 客缺${params.suspensions.awayMissing.join(',') || '无'}`,
        category: '阵容',
      });
    }
  }

  // 1b. 长途飞行疲劳
  {
    const hFatigue = params.travel.homeTravelFatigue;
    const aFatigue = params.travel.awayTravelFatigue;
    const hAdj = CLAMP(1 - hFatigue * 0.2, 0.88, 1.0);
    const aAdj = CLAMP(1 - aFatigue * 0.2, 0.88, 1.0);
    homeMult *= hAdj;
    awayMult *= aAdj;
    if (hFatigue > 0.05 || aFatigue > 0.05) {
      details.push({
        factor: '长途飞行',
        homeAdj: hAdj, awayAdj: aAdj,
        reason: `主${params.travel.homeDistanceKm}km/时差${params.travel.homeJetLag}h 客${params.travel.awayDistanceKm}km/时差${params.travel.awayJetLag}h`,
        category: '阵容',
      });
    }
  }

  // 1c. 替补深度 (缺人后防线崩盘程度)
  if (params.suspensions.homeImpact > 0 || params.suspensions.awayImpact > 0) {
    const depthH = 1 + (params.homeRolling.ga - 1.2) * 0.1 * params.suspensions.homeImpact;
    const depthA = 1 + (params.awayRolling.ga - 1.2) * 0.1 * params.suspensions.awayImpact;
    const hAdj = CLAMP(depthH, 0.92, 1.08);
    const aAdj = CLAMP(depthA, 0.92, 1.08);
    homeMult *= hAdj;
    awayMult *= aAdj;
    details.push({
      factor: '替补深度',
      homeAdj: hAdj, awayAdj: aAdj,
      reason: `主力缺阵后防守变化: 主${hAdj > 1 ? '恶化' : '维持'} 客${aAdj > 1 ? '恶化' : '维持'}`,
      category: '阵容',
    });
  }

  // ═══════════════════════════════════════
  // 二、赛制、战意、晋级博弈类
  // ═══════════════════════════════════════

  // 2a. 赛事权重
  {
    const w = params.tournament.stageWeight;
    // 越重要 → 双方越投入 → 总进球略降 (谨慎)
    const adj = CLAMP(1 - (w - 1) * 0.15, 0.88, 1.0);
    homeMult *= adj; awayMult *= adj;
    if (w > 1.05) {
      details.push({
        factor: '赛事权重',
        homeAdj: adj, awayAdj: adj,
        reason: `${w > 1.3 ? '决赛/半决赛' : '淘汰赛'} → 双方谨慎，进球 -${((1-adj)*100).toFixed(0)}%`,
        category: '赛制',
      });
    }
  }

  // 2b. 出线压力
  {
    const hP = params.homePressure.pressureScore;
    const aP = params.awayPressure.pressureScore;
    const hAdj = CLAMP(1 + (hP - 0.5) * 0.25, 0.88, 1.12);
    const aAdj = CLAMP(1 + (aP - 0.5) * 0.25, 0.88, 1.12);
    homeMult *= hAdj; awayMult *= aAdj;
    details.push({
      factor: '出线压力',
      homeAdj: hAdj, awayAdj: aAdj,
      reason: `主${params.homePressure.mustWin ? '必须赢' : params.homePressure.alreadyQualified ? '已出线' : params.homePressure.canDraw ? '平局可出线' : '一般'} 客${params.awayPressure.mustWin ? '必须赢' : params.awayPressure.alreadyQualified ? '已出线' : params.awayPressure.canDraw ? '平局可出线' : '一般'}`,
      category: '赛制',
    });
  }

  // 2c. 淘汰赛特殊
  if (params.tournament.isKnockout) {
    homeMult *= 0.90; awayMult *= 0.90;
    details.push({
      factor: '淘汰赛保守', homeAdj: 0.90, awayAdj: 0.90,
      reason: '单场淘汰 → 双方极度谨慎，总进球 -10%',
      category: '赛制',
    });
  }

  // 2d. 默契球
  if (params.tournament.collusionPossible) {
    homeMult *= 0.85; awayMult *= 0.85;
    details.push({
      factor: '默契球预警', homeAdj: 0.85, awayAdj: 0.85,
      reason: '末轮积分净胜球接近，平局对双方有利 → 小球 +15%',
      category: '赛制',
    });
  }

  // ═══════════════════════════════════════
  // 三、场地、环境、天气
  // ═══════════════════════════════════════

  // 3a. 场地海拔
  if (params.altitude > 1500) {
    homeMult *= 1.06;
    details.push({
      factor: '高原主场', homeAdj: 1.06, awayAdj: 1.0,
      reason: `${params.altitude}m → 主队心肺适应 +6%`,
      category: '场地',
    });
  }

  // 3b. 天气影响
  if (params.weather) {
    const w = params.weather;
    if (w.isExtremeHeat) {
      homeMult *= 0.92; awayMult *= 0.92;
      details.push({ factor: '高温', homeAdj: 0.92, awayAdj: 0.92, reason: `${w.temperature}°C → 体能消耗大 -8%`, category: '场地' });
    }
    if (w.isRain) {
      homeMult *= 0.93; awayMult *= 0.93;
      details.push({ factor: '降雨', homeAdj: 0.93, awayAdj: 0.93, reason: `${w.precipitation}mm → 湿滑 -7%`, category: '场地' });
    }
    if (w.windSpeed > 30) {
      homeMult *= 0.95; awayMult *= 0.95;
      details.push({ factor: '强风', homeAdj: 0.95, awayAdj: 0.95, reason: `${w.windSpeed}km/h → -5%`, category: '场地' });
    }
  }

  // 3c. 裁判尺度
  {
    const refGoalImpact = params.referee.goalImpact;
    homeMult *= refGoalImpact; awayMult *= refGoalImpact;
    if (refGoalImpact !== 1.0) {
      details.push({
        factor: '裁判尺度',
        homeAdj: refGoalImpact, awayAdj: refGoalImpact,
        reason: `${params.referee.name} strictness=${params.referee.strictness} → 进球${refGoalImpact > 1 ? '+' : ''}${((refGoalImpact-1)*100).toFixed(0)}%`,
        category: '场地',
      });
    }
  }

  // ═══════════════════════════════════════
  // 四、战术、交锋、克制
  // ═══════════════════════════════════════

  // 4a. 防守形态 (近6场失球)
  {
    const hAdj = CLAMP(1 + (1.2 - params.homeRolling.ga) * 0.25, 0.85, 1.15);
    const aAdj = CLAMP(1 + (1.2 - params.awayRolling.ga) * 0.25, 0.85, 1.15);
    awayMult *= hAdj; homeMult *= aAdj;
    details.push({
      factor: '防守形态', homeAdj: aAdj, awayAdj: hAdj,
      reason: `主失${params.homeRolling.ga.toFixed(2)}/场 客失${params.awayRolling.ga.toFixed(2)}/场`,
      category: '战术',
    });
  }

  // 4b. 零封率
  {
    const hAdj = CLAMP(1 + (params.homeRolling.cleanSheets - 0.2) * 0.2, 0.88, 1.12);
    const aAdj = CLAMP(1 + (params.awayRolling.cleanSheets - 0.2) * 0.2, 0.88, 1.12);
    awayMult *= hAdj; homeMult *= aAdj;
    details.push({
      factor: '零封率', homeAdj: aAdj, awayAdj: hAdj,
      reason: `主${(params.homeRolling.cleanSheets*100).toFixed(0)}% 客${(params.awayRolling.cleanSheets*100).toFixed(0)}%`,
      category: '战术',
    });
  }

  // 4c. H2H 心理压制
  if (params.h2h.meetings >= 2) {
    const avgGD = params.h2h.goalDiff / params.h2h.meetings;
    const hAdj = CLAMP(1 + avgGD * 0.04, 0.90, 1.10);
    const aAdj = CLAMP(1 - avgGD * 0.04, 0.90, 1.10);
    homeMult *= hAdj; awayMult *= aAdj;
    details.push({
      factor: 'H2H 心理', homeAdj: hAdj, awayAdj: aAdj,
      reason: `近${params.h2h.meetings}场${params.h2h.last3Results} 净胜${params.h2h.goalDiff > 0 ? '+' : ''}${params.h2h.goalDiff} 平局率${(params.h2h.drawRate*100).toFixed(0)}%`,
      category: '战术',
    });
  }

  // 4d. 阵型克制 (如果有 matchEvents 数据)
  if (params.matchEvents?.formation) {
    const hForm = params.matchEvents.formation.home;
    const aForm = params.matchEvents.formation.away;
    // 3-defender → 更多空间 → 更多进球
    const is3back = (f: string) => f.startsWith('3') || f.startsWith('5');
    if (is3back(hForm) || is3back(aForm)) {
      const adj = 1.04; // 3后卫体系进球偏多
      homeMult *= adj; awayMult *= adj;
      details.push({
        factor: '阵型', homeAdj: adj, awayAdj: adj,
        reason: `主${hForm} vs 客${aForm} → ${is3back(hForm) && is3back(aForm) ? '双方3后卫' : '3后卫体系'}，空间↑进球+4%`,
        category: '战术',
      });
    }
  }

  // 4e. 射门数据 (如果有)
  if (params.matchEvents?.shots) {
    const hSot = params.matchEvents.shotsOnTarget.home;
    const aSot = params.matchEvents.shotsOnTarget.away;
    if (hSot > 8) { homeMult *= 1.03; }
    if (aSot > 8) { awayMult *= 1.03; }
  }

  // ═══════════════════════════════════════
  // 五、赛程、体能、节奏
  // ═══════════════════════════════════════

  // 5a. 心理冲击
  {
    const hPsych = params.homeRolling.lastGoalDiff;
    const aPsych = params.awayRolling.lastGoalDiff;
    const hAdj = hPsych <= -3 ? 0.88 : hPsych >= 3 ? 1.08 : 1.0;
    const aAdj = aPsych <= -3 ? 0.88 : aPsych >= 3 ? 1.08 : 1.0;
    homeMult *= hAdj; awayMult *= aAdj;
    if (hAdj !== 1.0 || aAdj !== 1.0) {
      details.push({
        factor: '心理冲击', homeAdj: hAdj, awayAdj: aAdj,
        reason: `主上一场${hPsych>0?'+':''}${hPsych} 客${aPsych>0?'+':''}${aPsych}${hPsych<=-3?' (惨败)':''}${aPsych<=-3?' (惨败)':''}`,
        category: '体能',
      });
    }
  }

  // 5b. 势头
  {
    const hStreak = params.homeRolling.unbeatenStreak - params.homeRolling.losingStreak;
    const aStreak = params.awayRolling.unbeatenStreak - params.awayRolling.losingStreak;
    const hAdj = CLAMP(1 + hStreak * 0.03, 0.90, 1.10);
    const aAdj = CLAMP(1 + aStreak * 0.03, 0.90, 1.10);
    homeMult *= hAdj; awayMult *= aAdj;
    if (Math.abs(hStreak) >= 2 || Math.abs(aStreak) >= 2) {
      details.push({
        factor: '势头', homeAdj: hAdj, awayAdj: aAdj,
        reason: `主${hStreak>=0?'不败'+hStreak:'连败'+Math.abs(hStreak)}场 客${aStreak>=0?'不败'+aStreak:'连败'+Math.abs(aStreak)}场`,
        category: '体能',
      });
    }
  }

  // 5c. 赛程密集度
  {
    const hAdj = CLAMP(1 - params.schedule.homeFatigueScore * 1.5, 0.90, 1.0);
    const aAdj = CLAMP(1 - params.schedule.awayFatigueScore * 1.5, 0.90, 1.0);
    homeMult *= hAdj; awayMult *= aAdj;
    if (params.schedule.homeMatch3in7 || params.schedule.awayMatch3in7) {
      details.push({
        factor: '赛程密集', homeAdj: hAdj, awayAdj: aAdj,
        reason: `主${params.schedule.homeDaysSinceLast}天前有比赛${params.schedule.homeMatch3in7 ? ' 7天3赛!' : ''} 客${params.schedule.awayDaysSinceLast}天前${params.schedule.awayMatch3in7 ? ' 7天3赛!' : ''}`,
        category: '体能',
      });
    }
  }

  // 5d. 小组第三轮慢热
  if (params.tournament.isGroupMatch3) {
    homeMult *= 0.94; awayMult *= 0.94;
    details.push({
      factor: '小组第三轮慢热', homeAdj: 0.94, awayAdj: 0.94,
      reason: '小组收官战普遍进攻欲望下降 → 进球 -6%',
      category: '体能',
    });
  }

  // 5e. 主场形态
  if (params.isHome) {
    const hgf = params.homeSep.homeGF, hga = params.homeSep.homeGA;
    const agf = params.awaySep.awayGF, aga = params.awaySep.awayGA;
    const venueAdv = (hgf - hga) - (agf - aga); // positive = home has venue advantage
    const adj = CLAMP(1 + venueAdv * 0.06, 0.92, 1.08);
    homeMult *= adj;
    details.push({
      factor: '主场形态', homeAdj: adj, awayAdj: 1.0,
      reason: `主主场${hgf.toFixed(1)}-${hga.toFixed(1)} 客客场${agf.toFixed(1)}-${aga.toFixed(1)}`,
      category: '体能',
    });
  }

  // ── 全局钳制 ±30% ──
  homeMult = CLAMP(homeMult, 0.70, 1.30);
  awayMult = CLAMP(awayMult, 0.70, 1.30);

  return {
    homeMultiplier: parseFloat(homeMult.toFixed(4)),
    awayMultiplier: parseFloat(awayMult.toFixed(4)),
    details,
  };
}
