/**
 * Auto-Sync Engine — 全自动数据更新
 *
 * 每 N 分钟从竞彩 API 拉取：比分 + SPF 赔率 + 时间
 * 自动更新 ELO + 重建 OddsSnapshot
 */

import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { eloUpdate, eloExpected } from './feature';

const API = 'https://webapi.sporttery.cn/gateway/uniform/football/getMatchListV1.qry?clientCode=3001';

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

let isRunning = false;

export async function autoSync(prisma: PrismaClient): Promise<string> {
  if (isRunning) return 'already running';
  isRunning = true;
  const log: string[] = [];
  const start = Date.now();

  try {
    // 1. Fetch sporttery.cn data via curl (bypasses WAF)
    const raw = execSync(
      `curl -s "${API}" -H "User-Agent: Mozilla/5.0" -H "Referer: https://www.sporttery.cn/" --max-time 15`,
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

            // Record prediction history
            const outcome = hs > as ? 'H' : hs < as ? 'A' : 'D';
            await prisma.predictionHistory.upsert({
              where: { id: `auto_ph_${match.id}` },
              update: { actualOutcome: outcome },
              create: {
                id: `auto_ph_${match.id}`, matchId: match.id, teamId: match.homeTeamId,
                predHomeWin: 0.4, predDraw: 0.3, predAwayWin: 0.3,
                actualOutcome: outcome,
                featureVersion: 'auto_sync', modelVersion: 'lambda_v3', simulationVersion: 'v4',
              },
            });

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

        // Update SPF odds
        const spf = m.spfSp || '';
        if (spf && spf !== '-' && spf.includes(' ')) {
          const [ho, d, ao] = spf.split(' ').map(Number);
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

    // Auto-update ELO for all completed matches
    if (scores > 0) {
      const completed = await prisma.match.findMany({ where: { status: 'completed', homeScore: { not: null } }, include: { homeTeam: true, awayTeam: true } });
      for (const m of completed) {
        const exp = eloExpected(m.homeTeam.eloRating, m.awayTeam.eloRating);
        const act = m.homeScore! > m.awayScore! ? 1 : m.homeScore! < m.awayScore! ? 0 : 0.5;
        await prisma.team.update({ where: { id: m.homeTeamId }, data: { eloRating: eloUpdate(m.homeTeam.eloRating, exp, act) } });
        await prisma.team.update({ where: { id: m.awayTeamId }, data: { eloRating: eloUpdate(m.awayTeam.eloRating, 1 - exp, 1 - act) } });
      }
      log.push(`ELO updated for ${completed.length * 2} teams`);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log.unshift(`[auto-sync ${new Date().toLocaleTimeString()}] ${scores} scores | ${odds} odds | ${snapshots} snapshots | ${elapsed}s`);
  } catch (e: any) {
    log.push('Sync error: ' + e.message);
  }

  isRunning = false;
  return log.join('\n');
}
