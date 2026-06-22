/**
 * Auto-Sync Engine — 全自动数据更新
 *
 * 每 N 分钟:
 *   竞彩 API → SPF 赔率 + 时间
 *   worldcup26.ir → 完场比分
 * 自动更新 ELO + 重建 OddsSnapshot
 */

import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { eloUpdate, eloExpected } from './feature';
import { updateAllTeamStats } from './jobs/updateTeamStats';
import { trainModelV2 } from './ml/trainer_v2';
import { runCalibration } from './calibration/calibration';
import { runDriftMonitor } from './calibration/driftMonitor';
import { ternaryBrier, rankedProbabilityScore } from './calibration/metrics';

// Rolling RPS for drift detection
let rollingRpsHistory: number[] = [];
const RPS_WINDOW = 10;
const RPS_DRIFT_THRESHOLD = 0.05; // >5% degradation triggers retrain

const API = 'https://webapi.sporttery.cn/gateway/uniform/football/getMatchListV1.qry?clientCode=3001';
const SCORE_API = 'https://worldcup26.ir/get/games';

// Chinese → our team IDs
const NAME_MAP: Record<string, string> = {
  '墨西哥': 'mex', '南非': 'rsa', '韩国': 'kor', '捷克': 'cze',
  '加拿大': 'can', '波黑': 'bih', '卡塔尔': 'qat', '瑞士': 'sui',
  '巴西': 'bra', '摩洛哥': 'mar', '海地': 'hai', '苏格兰': 'sco',
  '美国': 'usa', '巴拉圭': 'par', '澳大利亚': 'aus', '土耳其': 'tur',
  '德国': 'ger', '库拉索': 'cuw', '科特迪瓦': 'civ', '厄瓜多尔': 'ecu',
  '荷兰': 'ned', '日本': 'jpn', '瑞典': 'swe', '突尼斯': 'tun',
  '西班牙': 'esp', '佛得角': 'cpv', '沙特': 'ksa', '乌拉圭': 'uru',
  '比利时': 'bel', '埃及': 'egy', '伊朗': 'irn', '新西兰': 'nzl',
  '法国': 'fra', '塞内加尔': 'sen', '伊拉克': 'irq', '挪威': 'nor',
  '阿根廷': 'arg', '阿尔及利': 'alg', '奥地利': 'aut', '约旦': 'jor',
  '葡萄牙': 'por', '哥伦比亚': 'col', '刚果金': 'cod', '乌兹别克': 'uzb',
  '英格兰': 'eng', '克罗地亚': 'cro', '加纳': 'gha', '巴拿马': 'pan',
};

// English team name → our team IDs (for worldcup26.ir API)
const EN_NAME_MAP: Record<string, string> = {
  'Mexico': 'mex', 'South Africa': 'rsa', 'South Korea': 'kor', 'Czech Republic': 'cze',
  'Canada': 'can', 'Bosnia and Herzegovina': 'bih', 'Qatar': 'qat', 'Switzerland': 'sui',
  'Brazil': 'bra', 'Morocco': 'mar', 'Haiti': 'hai', 'Scotland': 'sco',
  'United States': 'usa', 'Paraguay': 'par', 'Australia': 'aus', 'Turkey': 'tur',
  'Germany': 'ger', 'Curaçao': 'cuw', 'Ivory Coast': 'civ', 'Ecuador': 'ecu',
  'Netherlands': 'ned', 'Japan': 'jpn', 'Sweden': 'swe', 'Tunisia': 'tun',
  'Spain': 'esp', 'Cape Verde': 'cpv', 'Saudi Arabia': 'ksa', 'Uruguay': 'uru',
  'Belgium': 'bel', 'Egypt': 'egy', 'Iran': 'irn', 'New Zealand': 'nzl',
  'France': 'fra', 'Senegal': 'sen', 'Iraq': 'irq', 'Norway': 'nor',
  'Argentina': 'arg', 'Algeria': 'alg', 'Austria': 'aut', 'Jordan': 'jor',
  'Portugal': 'por', 'Colombia': 'col', 'DR Congo': 'cod', 'Uzbekistan': 'uzb',
  'Democratic Republic of the Congo': 'cod',
  'England': 'eng', 'Croatia': 'cro', 'Ghana': 'gha', 'Panama': 'pan',
};

let isRunning = false;

export async function autoSync(prisma: PrismaClient): Promise<string> {
  if (isRunning) return 'already running';
  isRunning = true;
  const log: string[] = [];
  const start = Date.now();

  try {
    // 1. Fetch sporttery.cn data via curl (bypasses WAF)
    const raw = execSync(
      `curl -s "${API}" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" -H "Accept: application/json, text/plain, */*" -H "Referer: https://www.sporttery.cn/jc/zqszsc/" -H "Origin: https://www.sporttery.cn" -H "Accept-Language: zh-CN,zh;q=0.9" --max-time 15`,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    );
    const data = JSON.parse(raw);
    if (data.errorCode !== '0') { log.push('API error: ' + data.errorMessage); isRunning = false; return log.join('\n'); }

    const matchList = data.value.matchInfoList || [];
    let scores = 0, odds = 0, snapshots = 0;

    for (const day of matchList) {
      for (const m of day.subMatchList || []) {
        if (m.leagueAbbName !== '世界杯') continue;
        const homeId = NAME_MAP[m.homeTeamAbbName || ''];
        const awayId = NAME_MAP[m.awayTeamAbbName || ''];
        if (!homeId || !awayId) continue;

        // Find match
        const match = await prisma.match.findFirst({
          where: { homeTeamId: homeId, awayTeamId: awayId, status: { in: ['scheduled', 'completed'] } },
        });
        if (!match) continue;

        // Update score
        if (m.homeScore && m.homeScore !== '-' && m.awayScore && m.awayScore !== '-') {
          const hs = parseInt(m.homeScore), as = parseInt(m.awayScore);
          if (!isNaN(hs) && !isNaN(as) && match.status !== 'completed') {
            await prisma.match.update({ where: { id: match.id }, data: { status: 'completed', homeScore: hs, awayScore: as } });
            scores++;
            log.push(`⚽ ${m.homeTeamAbbName} ${hs}-${as} ${m.awayTeamAbbName}`);

            // Backfill actualOutcome for real model predictions only (no baseline creation)
            const outcome = hs > as ? 'H' : hs < as ? 'A' : 'D';
            // Backfill actualOutcome for ALL real model predictions of this match
            const updated = await prisma.predictionHistory.updateMany({
              where: { matchId: match.id, actualOutcome: null },
              data: { actualOutcome: outcome },
            });
            if (updated.count > 0) {
              log.push(`  📊 backfilled ${updated.count} prediction(s) for ${match.id}`);

              // Compute RPS/Brier for model evaluation
              const backfilledPreds = await prisma.predictionHistory.findMany({
                where: { matchId: match.id, actualOutcome: outcome },
                select: { predHomeWin: true, predDraw: true, predAwayWin: true, modelVersion: true },
              });
              let totalBrier = 0, totalRPS = 0, count = 0;
              for (const bp of backfilledPreds) {
                const b = ternaryBrier(bp.predHomeWin, bp.predDraw, bp.predAwayWin, outcome);
                const r = rankedProbabilityScore({ homeWin: bp.predHomeWin, draw: bp.predDraw, awayWin: bp.predAwayWin }, outcome);
                totalBrier += b; totalRPS += r; count++;
              }
              if (count > 0) {
                const avgRps = totalRPS / count;
                const avgBrier = totalBrier / count;
                log.push(`  📈 [RPS=${avgRps.toFixed(4)} Brier=${avgBrier.toFixed(4)}] (${count} predictions)`);

                // Online drift detection
                rollingRpsHistory.push(avgRps);
                if (rollingRpsHistory.length > RPS_WINDOW) rollingRpsHistory.shift();
                if (rollingRpsHistory.length >= 5) {
                  const recentAvg = rollingRpsHistory.reduce((a,b) => a+b, 0) / rollingRpsHistory.length;
                  if (recentAvg > rollingRpsHistory[0] + RPS_DRIFT_THRESHOLD) {
                    log.push(`  ⚠️ [DRIFT] RPS degrading (${rollingRpsHistory[0].toFixed(3)} → ${recentAvg.toFixed(3)}), triggering retrain`);
                    // Trigger async retrain
                    trainModelV2(prisma).then(r => {
                      console.log(`[AUTO-RETRAIN] ${r.samplesUsed} samples, loss=${r.finalLoss.toFixed(4)}`);
                    }).catch(() => {});
                    rollingRpsHistory = []; // reset window after retrain
                  }
                }
              }
            }

            // Update ELO
            const ht = await prisma.team.findUnique({ where: { id: homeId } });
            const at = await prisma.team.findUnique({ where: { id: awayId } });
            if (ht && at) {
              const exp = eloExpected(ht.eloRating, at.eloRating);
              const act = outcome === 'H' ? 1 : outcome === 'D' ? 0.5 : 0;
              await prisma.team.update({ where: { id: homeId }, data: { eloRating: eloUpdate(ht.eloRating, exp, act) } });
              await prisma.team.update({ where: { id: awayId }, data: { eloRating: eloUpdate(at.eloRating, 1 - exp, 1 - act) } });
            }
          }
        }

        // Update HAD odds (胜平负) from oddsList
        const hadOdds = (m.oddsList || []).find((o: any) => o.poolCode === 'HAD');
        if (hadOdds && hadOdds.h && hadOdds.d && hadOdds.a) {
          const ho = parseFloat(hadOdds.h);
          const d = parseFloat(hadOdds.d);
          const ao = parseFloat(hadOdds.a);
          if (!isNaN(ho)) {
            await prisma.odds.upsert({
              where: { id: `live_o_${match.id}` },
              update: { currentHomeOdds: ho, currentDrawOdds: d, currentAwayOdds: ao },
              create: { id: `live_o_${match.id}`, matchId: match.id, currentHomeOdds: ho, currentDrawOdds: d, currentAwayOdds: ao },
            });
            await prisma.oddsSnapshot.create({
              data: { matchId: match.id, homeOdds: ho, drawOdds: d, awayOdds: ao, source: 'sporttery' },
            });
            odds++;
            snapshots++;
          }
        }
      }
    }

    // 2. Fetch scores from worldcup26.ir API
    let scoreSyncCount = 0;
    try {
      const axios = (await import('axios')).default;
      const { data: scoreData } = await axios.get(SCORE_API, { timeout: 30000 });
      const games = scoreData.games || [];
      const finished = games.filter((g: any) => g.finished === 'TRUE');

      for (const g of finished) {
        const homeId = EN_NAME_MAP[g.home_team_name_en];
        const awayId = EN_NAME_MAP[g.away_team_name_en];
        if (!homeId || !awayId) continue;

        const hs = parseInt(g.home_score), as = parseInt(g.away_score);
        if (isNaN(hs) || isNaN(as)) continue;

        const match = await prisma.match.findFirst({
          where: { homeTeamId: homeId, awayTeamId: awayId, status: { in: ['scheduled', 'completed'] } },
        });
        if (!match) continue;
        if (match.status === 'completed' && match.homeScore === hs && match.awayScore === as) continue;

        const outcome = hs > as ? 'H' : hs < as ? 'A' : 'D';
        await prisma.match.update({
          where: { id: match.id },
          data: { status: 'completed', homeScore: hs, awayScore: as },
        });
        await prisma.predictionHistory.updateMany({
          where: { matchId: match.id, actualOutcome: null },
          data: { actualOutcome: outcome },
        });
        // ELO
        const ht = await prisma.team.findUnique({ where: { id: homeId } });
        const at = await prisma.team.findUnique({ where: { id: awayId } });
        if (ht && at) {
          const exp = eloExpected(ht.eloRating, at.eloRating);
          const act = outcome === 'H' ? 1 : outcome === 'D' ? 0.5 : 0;
          await prisma.team.update({ where: { id: homeId }, data: { eloRating: eloUpdate(ht.eloRating, exp, act) } });
          await prisma.team.update({ where: { id: awayId }, data: { eloRating: eloUpdate(at.eloRating, 1 - exp, 1 - act) } });
        }
        scoreSyncCount++;
        log.push(`⚽ [API] ${g.home_team_name_en} ${hs}-${as} ${g.away_team_name_en} → ${match.id}`);
      }
    } catch (e: any) {
      // worldcup26.ir API might be down, don't fail the whole sync
      log.push('Score API error: ' + e.message);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log.unshift(`[auto-sync ${new Date().toLocaleTimeString()}] ${scores}+${scoreSyncCount} scores | ${odds} odds | ${snapshots} snapshots | ${elapsed}s`);
  } catch (e: any) {
    log.push('Sync error: ' + e.message);
  }

  // Update TeamStats from real match data after scores are synced
  try {
    const tsLog = await updateAllTeamStats(prisma);
    log.push(...tsLog);
  } catch (e: any) {
    log.push('[TeamStats] update failed: ' + e.message);
  }

  // ML retrain — 仅在满足条件时触发 (防权重震荡)
  // 条件: ≥10场新完成比赛 或 距上次训练≥24小时
  try {
    const lastTrain = await prisma.predictionHistory.findFirst({
      where: { actualOutcome: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const hoursSinceLastTrain = lastTrain
      ? (Date.now() - new Date(lastTrain.createdAt).getTime()) / 3600000
      : 999;

    const newSamples = await prisma.predictionHistory.count({
      where: {
        actualOutcome: { not: null },
        createdAt: lastTrain ? { gt: lastTrain.createdAt } : undefined,
      },
    });

    const shouldTrain = newSamples >= 10 || hoursSinceLastTrain >= 24;
    if (shouldTrain) {
      const mlResult = await trainModelV2(prisma);
      log.push(`[ML v2] ${mlResult.samplesUsed} samples · loss=${mlResult.finalLoss.toFixed(4)} · CV Brier=${mlResult.cvBrier.toFixed(4)} Acc=${mlResult.cvAccuracy.toFixed(2)}`);
    } else {
      log.push(`[ML] skip retrain (${newSamples} new samples, ${hoursSinceLastTrain.toFixed(0)}h since last train)`);
    }
  } catch (e: any) {
    log.push('[ML] retrain failed: ' + e.message);
  }

  // Run calibration on accumulated predictions (Platt + Isotonic)
  try {
    const calReport = await runCalibration(prisma);
    if (calReport.samplesUsed > 0) {
      const s = calReport.outcomeSlopes, ic = calReport.outcomeIntercepts;
      log.push(`[Cal] ${calReport.samplesUsed} samples · ECE=${calReport.ece.toFixed(4)} · Brier=${calReport.brierScore.toFixed(4)}`);
      log.push(`[Cal]   H: slope=${s.H.toFixed(2)} int=${ic.H.toFixed(2)} | D: slope=${s.D.toFixed(2)} int=${ic.D.toFixed(2)} | A: slope=${s.A.toFixed(2)} int=${ic.A.toFixed(2)}`);
    }
  } catch (e: any) {
    log.push('[Cal] calibration failed: ' + e.message);
  }

  // Drift monitor
  try {
    const drift = await runDriftMonitor(prisma);
    if (drift.overallStatus !== 'ok') {
      log.push(`[Drift] ${drift.overallStatus}: ${drift.recommendations.join('; ')}`);
    }
  } catch (_e: any) {}

  isRunning = false;
  return log.join('\n');
}
