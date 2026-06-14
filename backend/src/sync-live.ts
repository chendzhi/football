/**
 * 实时数据同步 — curl 绕 WAF → sporttery.cn 竞彩 API
 *
 * 数据: 真实比分 + 开赛时间 + 胜平负赔率
 * 用法: npx ts-node src/sync-live.ts
 */

import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const API_URL = 'https://webapi.sporttery.cn/gateway/uniform/football/getMatchListV1.qry?clientCode=3001';

// ─── Team name mapping (竞彩中文 → 我们英文名) ───
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

function fetchSporttery(): any {
  const cmd = `curl -s "${API_URL}" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)" -H "Referer: https://www.sporttery.cn/jc/zqszsc/" --max-time 15`;
  const raw = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(raw);
}

async function sync() {
  console.log('📡 拉取竞彩实时数据...');
  const data = fetchSporttery();

  if (data.errorCode !== '0') {
    console.error('API 错误:', data.errorMessage);
    return;
  }

  const matchList = data.value.matchInfoList || [];
  const updateTime = data.value.lastUpdateTime;
  console.log(`   更新时间: ${updateTime}`);

  let scoreUpdates = 0;
  let oddsUpdates = 0;
  let newMatches = 0;

  for (const day of matchList) {
    for (const m of day.subMatchList || []) {
      if (m.leagueAbbName !== '世界杯') continue;

      const homeCn = m.homeTeamAbbName || '';
      const awayCn = m.awayTeamAbbName || '';
      const homeId = NAME_MAP[homeCn];
      const awayId = NAME_MAP[awayCn];

      if (!homeId || !awayId) {
        console.log(`  ⚠️  未匹配: ${homeCn} vs ${awayCn}`);
        continue;
      }

      // Find match by teams + date
      const matchDate = `${m.matchDate}T${m.matchTime || '00:00:00'}`;
      // sporttery time is Beijing → convert to UTC
      const bjDate = new Date(matchDate);
      const utcDate = new Date(bjDate.getTime() - 8 * 3600 * 1000);

      // Find existing match
      let match = await prisma.match.findFirst({
        where: {
          homeTeamId: homeId,
          awayTeamId: awayId,
          matchDate: {
            gte: new Date(utcDate.getTime() - 3600 * 1000),
            lte: new Date(utcDate.getTime() + 3600 * 1000),
          },
        },
      });

      // If match doesn't exist, create it
      if (!match) {
        const matchId = `live_${m.matchNumStr || `${homeId}_${awayId}`}`;
        const stage = m.leageAbbName || 'GROUP_STAGE';
        match = await prisma.match.upsert({
          where: { id: matchId },
          update: { matchDate: utcDate },
          create: {
            id: matchId,
            matchDate: utcDate,
            groupName: `${homeCn.charAt(0)}组` || 'World Cup',
            stage: 'GROUP_STAGE',
            homeTeamId: homeId,
            awayTeamId: awayId,
            status: 'scheduled',
          },
        });
        newMatches++;
      } else {
        // Update match time to real time
        await prisma.match.update({
          where: { id: match.id },
          data: { matchDate: utcDate },
        });
      }

      // Update score if available
      if (m.homeScore !== '' && m.homeScore !== undefined && m.homeScore !== '-') {
        const hs = parseInt(m.homeScore);
        const as = parseInt(m.awayScore);
        if (!isNaN(hs) && !isNaN(as)) {
          const prevStatus = match.status;
          await prisma.match.update({
            where: { id: match.id },
            data: { status: 'completed', homeScore: hs, awayScore: as },
          });
          if (prevStatus !== 'completed') {
            scoreUpdates++;
            const outcome = hs > as ? 'H' : hs < as ? 'A' : 'D';
            // Record prediction history
            await prisma.predictionHistory.upsert({
              where: { id: `live_ph_${match.id}` },
              update: { actualOutcome: outcome },
              create: {
                id: `live_ph_${match.id}`,
                matchId: match.id,
                teamId: match.homeTeamId,
                predHomeWin: 0.4, predDraw: 0.3, predAwayWin: 0.3,
                actualOutcome: outcome,
                featureVersion: 'live_sync',
                modelVersion: 'lambda_v1.0',
                simulationVersion: 'simulation_v1.0',
              },
            });
            console.log(`  ⚽ ${homeCn} ${hs}-${as} ${awayCn}`);
          }
        }
      }

      // Update odds (SPF = 胜平负赔率)
      const spf = m.spfSp || '';
      if (spf && spf !== '-' && spf.includes(' ')) {
        const parts = spf.split(' ');
        if (parts.length >= 3) {
          const ho = parseFloat(parts[0]);
          const d = parseFloat(parts[1]);
          const ao = parseFloat(parts[2]);
          if (!isNaN(ho)) {
            await prisma.odds.upsert({
              where: { id: `live_o_${match.id}` },
              update: { currentHomeOdds: ho, currentDrawOdds: d, currentAwayOdds: ao },
              create: { id: `live_o_${match.id}`, matchId: match.id, currentHomeOdds: ho, currentDrawOdds: d, currentAwayOdds: ao },
            });
            oddsUpdates++;
          }
        }
      }

      // Record OddsSnapshot for time-series
      const spfSnapshot = m.spfSp || '';
      if (spfSnapshot && spfSnapshot !== '-' && spfSnapshot.includes(' ')) {
        const p = spfSnapshot.split(' ');
        if (p.length >= 3) {
          await prisma.oddsSnapshot.create({
            data: {
              matchId: match.id,
              homeOdds: parseFloat(p[0]),
              drawOdds: parseFloat(p[1]),
              awayOdds: parseFloat(p[2]),
              source: 'sporttery',
            },
          });
        }
      }
    }
  }

  console.log(`\n✅ 同步完成:`);
  console.log(`   ${scoreUpdates} 场新赛果`);
  console.log(`   ${oddsUpdates} 组赔率更新`);
  console.log(`   ${newMatches} 场新比赛`);
  console.log(`   竞彩更新时间: ${updateTime}`);
}

sync().then(async () => { await prisma.$disconnect(); }).catch(async (e) => {
  console.error('❌', e.message);
  await prisma.$disconnect();
  process.exit(1);
});
