/**
 * Odds Collector — 从竞彩 API 采集赔率时间序列
 *
 * 每 6 小时拉一次，构建 OddsSnapshot 时间序列，
 * 为 oddsVelocity + marketPressureIndex 提供数据基础。
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const API = 'https://webapi.sporttery.cn/gateway/uniform/football/getMatchListV1.qry?clientCode=3001';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  'Referer': 'https://www.sporttery.cn/jc/zqszsc/',
};

interface SportteryMatch {
  leagueAbbName: string;
  homeTeamAbbName: string;
  awayTeamAbbName: string;
  matchDate: string;
  matchTime: string;
  homeScore: string;
  awayScore: string;
  spfSp: string;          // 胜平负赔率 "1.85 3.40 4.50"
  rqspfSp: string;        // 让球胜平负赔率
  goalLine: string;       // 让球数
  matchNumStr: string;
}

export async function collectOdds(prisma: PrismaClient): Promise<number> {
  console.log('[OddsCollector] 拉取竞彩赔率...');

  let snapshots = 0;
  try {
    const { data } = await axios.get(API, { headers: HEADERS, timeout: 15000 });
    if (data.errorCode !== '0') {
      console.error('[OddsCollector] API error:', data.errorMessage);
      return 0;
    }

    const matchList: Array<{ subMatchList: SportteryMatch[] }> = data.value.matchInfoList || [];

    for (const day of matchList) {
      for (const m of day.subMatchList) {
        if (m.leagueAbbName !== '世界杯') continue;

        const spfParts = (m.spfSp || '').split(' ');
        if (spfParts.length < 3) continue;

        const homeOdds = parseFloat(spfParts[0]);
        const drawOdds = parseFloat(spfParts[1]);
        const awayOdds = parseFloat(spfParts[2]);
        if (isNaN(homeOdds)) continue;

        // Find match by date + teams
        const dateStr = `${m.matchDate}T${m.matchTime || '00:00:00'}Z`;
        const matches = await prisma.match.findMany({
          where: {
            matchDate: {
              gte: new Date(m.matchDate + 'T00:00:00Z'),
              lte: new Date(m.matchDate + 'T23:59:59Z'),
            },
          },
          include: { homeTeam: true, awayTeam: true },
        });

        for (const db of matches) {
          if (
            (db.homeTeam.chinaName === m.homeTeamAbbName || db.homeTeam.name === m.homeTeamAbbName) &&
            (db.awayTeam.chinaName === m.awayTeamAbbName || db.awayTeam.name === m.awayTeamAbbName)
          ) {
            // Create snapshot
            await prisma.oddsSnapshot.create({
              data: {
                matchId: db.id,
                homeOdds,
                drawOdds,
                awayOdds,
                source: 'sporttery',
              },
            });
            // Also update current odds
            await prisma.odds.upsert({
              where: { id: `o_${db.id}` },
              update: { currentHomeOdds: homeOdds, currentDrawOdds: drawOdds, currentAwayOdds: awayOdds },
              create: { id: `o_${db.id}`, matchId: db.id, currentHomeOdds: homeOdds, currentDrawOdds: drawOdds, currentAwayOdds: awayOdds },
            });
            snapshots++;
            break;
          }
        }
      }
    }

    console.log(`[OddsCollector] ${snapshots} snapshots saved`);
  } catch (err: any) {
    console.error('[OddsCollector] Failed:', err.message);
  }

  return snapshots;
}
