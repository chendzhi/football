/**
 * GET /api/explain/:matchId — Explain Engine 可解释性归因 API
 *
 * 将预测管道的中间数据曝光：λ 分解、泊松矩阵、特征敏感性。
 */

import { Router } from 'express';
import prisma from '../db';
import { computeLambda, type LambdaInput, type LambdaIntermediates } from '../feature';
import type { RawOddsFeatures } from '../types';
import { decomposeLambda } from '../explain/lambdaBreakdown';
import {
  generatePoissonMatrix,
  generatePoissonDistribution,
} from '../explain/poissonMatrix';
import { computeFeatureContribution } from '../explain/featureContribution';
import { generateHalfTimeScenarios } from '../explain/halfTimeScenarios';
import { VERSIONS } from '../version';
import { predictLambdaV2 } from '../ml/lambdaPredictor_v2';

const router = Router();

router.get('/explain/:matchId', async (req, res) => {
  try {
    const { matchId } = req.params;

    // 1. 加载比赛
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { homeTeam: true, awayTeam: true },
    });
    if (!match) return res.status(404).json({ error: 'Match not found' });

    // 2. 检查是否有已有预测快照
    const snapshot = await prisma.featureSnapshot.findFirst({
      where: { matchId },
      orderBy: { createdAt: 'desc' },
    });

    // 3. 加载 TeamStats (与 Predict API 相同数据源)
    const homeStats = await prisma.teamStats.findFirst({
      where: { teamId: match.homeTeamId },
    });
    const awayStats = await prisma.teamStats.findFirst({
      where: { teamId: match.awayTeamId },
    });

    const homeAttack = homeStats?.expectedGoalsFor ?? 1.3;
    const awayAttack = awayStats?.expectedGoalsFor ?? 1.3;
    const homeDefense = homeStats?.expectedGoalsAgst ?? 1.2;
    const awayDefense = awayStats?.expectedGoalsAgst ?? 1.2;
    const homeForm = homeStats?.formScore ?? 0.5;
    const awayForm = awayStats?.formScore ?? 0.5;
    const homeElo = match.homeTeam.eloRating;
    const awayElo = match.awayTeam.eloRating;

    // 4. 加载最新赔率
    const latestOdds = await prisma.odds.findFirst({
      where: { matchId: match.id },
      orderBy: { updatedAt: 'desc' },
    });
    const odds: RawOddsFeatures | null = latestOdds
      ? {
          homeOdds: latestOdds.currentHomeOdds,
          drawOdds: latestOdds.currentDrawOdds,
          awayOdds: latestOdds.currentAwayOdds,
        }
      : null;

    // 5. 构建 LambdaInput (与 simulation.ts 内部 build 一致)
    const lambdaInput: LambdaInput = {
      homeAttack,
      awayAttack,
      homeDefense,
      awayDefense,
      homeForm,
      awayForm,
      homeElo,
      awayElo,
      homeAdvantage: 1.1,
    };

    // 6. 使用与 Predict API 相同的 V2 ML 模型计算 λ (保证一致性)
    let homeLambda: number;
    let awayLambda: number;
    let intermediates: LambdaIntermediates;
    let usedSnapshot = false;

    if (snapshot && snapshot.homeLambda != null && snapshot.awayLambda != null) {
      homeLambda = snapshot.homeLambda;
      awayLambda = snapshot.awayLambda;
      const freshResult = computeLambda(lambdaInput);
      intermediates = freshResult.intermediates;
      usedSnapshot = true;
    } else {
      // Use predictLambdaV2 (same as predict.ts) for actual λ values
      const v2Result = predictLambdaV2({
        homeElo, awayElo,
        homeXG: homeAttack, awayXG: awayAttack,
        homeXGA: homeDefense, awayXGA: awayDefense,
        homeForm, awayForm,
        homeInjury: 0, awayInjury: 0,
        context: null,
      });
      homeLambda = v2Result.homeLambda;
      awayLambda = v2Result.awayLambda;
      // Compute approximate intermediates for decomposition
      const statResult = computeLambda(lambdaInput);
      intermediates = statResult.intermediates;
    }

    // 7. λ 分解
    const lambdaBreakdown = decomposeLambda(
      intermediates,
      homeAttack,
      awayAttack,
      homeDefense,
      awayDefense
    );

    // 8. 泊松矩阵 + 分布 (用最终 λ)
    const poissonMatrix = generatePoissonMatrix(homeLambda, awayLambda);
    const poissonDist = generatePoissonDistribution(homeLambda, awayLambda);

    // 9. 特征敏感性
    const featureContribution = computeFeatureContribution(
      lambdaInput,
      odds,
      homeLambda,
      awayLambda
    );

    // 9.5. 半场推演 (Poisson λ/2)
    const halfTimeScenarios = generateHalfTimeScenarios(homeLambda, awayLambda);

    // 10. 管道日志
    const pipelineLogs = buildPipelineLogs(
      match,
      homeAttack, awayAttack,
      homeDefense, awayDefense,
      homeForm, awayForm,
      homeElo, awayElo,
      intermediates,
      homeLambda, awayLambda,
      odds,
      snapshot,
      usedSnapshot
    );

    res.json({
      matchId,
      homeLambda,
      awayLambda,
      usedSnapshot,
      lambdaBreakdown,
      poissonMatrix,
      poissonDist,
      featureContribution,
      halfTimeScenarios,
      pipelineLogs,
    });
  } catch (error: any) {
    console.error('[EXPLAIN]', error);
    res.status(500).json({ error: 'Explain engine error', detail: error.message });
  }
});

function buildPipelineLogs(
  match: any,
  homeAttack: number,
  awayAttack: number,
  homeDefense: number,
  awayDefense: number,
  homeForm: number,
  awayForm: number,
  homeElo: number,
  awayElo: number,
  intermediates: LambdaIntermediates,
  homeLambda: number,
  awayLambda: number,
  odds: any,
  snapshot: any,
  usedSnapshot: boolean
): string[] {
  const inter = intermediates;
  const logs: string[] = [];

  const hName = match.homeTeam?.shortName || match.homeTeam?.name || match.homeTeamId;
  const aName = match.awayTeam?.shortName || match.awayTeam?.name || match.awayTeamId;

  logs.push(
    `>> [STEP 1/5] 数据采集: 主队(${hName}, ELO=${homeElo}, xGF=${homeAttack.toFixed(2)}, xGA=${homeDefense.toFixed(2)}, form=${homeForm.toFixed(2)}) | 客队(${aName}, ELO=${awayElo}, xGF=${awayAttack.toFixed(2)}, xGA=${awayDefense.toFixed(2)}, form=${awayForm.toFixed(2)})`
  );

  logs.push(
    `>> [STEP 2/5] λ 计算: eloDiff_raw=${inter.eloDiffRaw}, capped=${inter.eloDiffCapped.toFixed(1)}, eloFactor=${inter.eloFactor.toFixed(4)}, momentum=${inter.momentum.toFixed(4)}`
  );
  logs.push(
    `>>         主 λ_stat_raw=${inter.statHomeRaw.toFixed(4)} → clamped=${inter.statHomeClamped.toFixed(4)}`
  );
  logs.push(
    `>>         客 λ_stat_raw=${inter.statAwayRaw.toFixed(4)} → clamped=${inter.statAwayClamped.toFixed(4)}`
  );

  if (inter.hasMarket) {
    logs.push(
      `>> [STEP 3/5] 市场锚定: 赔率 λ_home=${inter.marketHomeLambda?.toFixed(4)}, λ_away=${inter.marketAwayLambda?.toFixed(4)}, blend=${(inter.blendWeight * 100).toFixed(0)}% 市场 + ${((1 - inter.blendWeight) * 100).toFixed(0)}% 统计`
    );
  } else {
    logs.push(`>> [STEP 3/5] 无赔率数据 → 纯统计模型 (100% 统计)`);
  }

  logs.push(
    `>> [STEP 4/5] Dixon-Coles 联合概率矩阵 (ρ=-0.25): 6×6 矩阵, 低比分 (0-0,1-0,0-1,1-1) 修正已应用`
  );

  logs.push(
    `>> [STEP 5/5] 特征敏感性分析: 6 个特征 ±10% 扰动, 解析法测量胜/平/负概率偏移`
  );

  if (usedSnapshot && snapshot) {
    logs.push(
      `>> [SYNC] λ 复用预测快照 (${snapshot.id}) — 与 Predict API 一致`
    );
  } else if (snapshot) {
    logs.push(
      `>> [CACHE] 已有预测快照: ${snapshot.id} (特征版本=${snapshot.featureVersion})`
    );
  } else {
    logs.push(`>> [FRESH] 无已有快照，全新计算`);
  }

  logs.push(
    `>> [FINAL] λ_home=${homeLambda}, λ_away=${awayLambda}`
  );

  return logs;
}

export default router;
