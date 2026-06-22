/**
 * 导入 martj42 国际比赛历史数据集 (2010+)
 * 筛选世界杯 48 队 → 计算历史 ELO → 扩展训练集
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// CSV team name → our team ID
const NAME_TO_ID: Record<string, string> = {
  'Argentina': 'arg', 'France': 'fra', 'Brazil': 'bra', 'England': 'eng',
  'Spain': 'esp', 'Germany': 'ger', 'Portugal': 'por', 'Netherlands': 'ned',
  'Belgium': 'bel', 'Croatia': 'cro', 'Morocco': 'mar', 'Uruguay': 'uru',
  'Colombia': 'col', 'United States': 'usa', 'Mexico': 'mex', 'Senegal': 'sen',
  'Japan': 'jpn', 'Switzerland': 'sui', 'Iran': 'irn', 'South Korea': 'kor',
  'Turkey': 'tur', 'Ecuador': 'ecu', 'Austria': 'aut', 'Australia': 'aus',
  'Norway': 'nor', 'Canada': 'can', 'Sweden': 'swe', 'Czech Republic': 'cze',
  'Scotland': 'sco', 'Paraguay': 'par', 'Algeria': 'alg', 'Egypt': 'egy',
  'Ivory Coast': 'civ', 'Tunisia': 'tun', 'Ghana': 'gha', 'South Africa': 'rsa',
  'DR Congo': 'cod', 'Panama': 'pan', 'Uzbekistan': 'uzb', 'Cape Verde': 'cpv',
  'Jordan': 'jor', 'Iraq': 'irq', 'New Zealand': 'nzl', 'Haiti': 'hai',
  'Curaçao': 'cuw', 'Qatar': 'qat', 'Saudi Arabia': 'ksa',
  'Bosnia and Herzegovina': 'bih',
};

// ELO constants
const K = 32;
const INITIAL_ELO = 1500;

interface ParsedMatch {
  date: string;
  home: string;
  away: string;
  hs: number;
  as: number;
  tournament: string;
  neutral: boolean;
}

function eloExpected(a: number, b: number): number {
  return 1 / (1 + Math.pow(10, -(a - b) / 400));
}

async function main() {
  const csvPath = path.join(__dirname, '..', 'results.csv');
  if (!fs.existsSync(csvPath)) {
    console.log('results.csv not found. Download from: https://github.com/martj42/international_results');
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n').slice(1); // skip header

  const matches: ParsedMatch[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(',');
    if (parts.length < 8) continue;
    const [date, home, away, hs, as, tournament, , , neutral] = parts;
    const year = parseInt(date.split('-')[0]);
    if (year < 2010) continue; // Only 2010+
    const homeId = NAME_TO_ID[home];
    const awayId = NAME_TO_ID[away];
    if (!homeId || !awayId) continue;
    matches.push({
      date, home: homeId, away: awayId,
      hs: parseInt(hs), as: parseInt(as),
      tournament: tournament || 'Friendly',
      neutral: neutral === 'TRUE',
    });
  }

  console.log(`Parsed ${matches.length} matches (2010+, 48 WC teams)`);

  // Compute historical ELO
  const eloMap: Record<string, number> = {};
  for (const id of Object.values(NAME_TO_ID)) eloMap[id] = INITIAL_ELO;

  let imported = 0;
  for (const m of matches) {
    // Update ELO
    const hElo = eloMap[m.home] || INITIAL_ELO;
    const aElo = eloMap[m.away] || INITIAL_ELO;
    const expected = eloExpected(hElo, aElo);
    const actual = m.hs > m.as ? 1 : m.hs < m.as ? 0 : 0.5;
    eloMap[m.home] = Math.round(hElo + K * (actual - expected));
    eloMap[m.away] = Math.round(aElo + K * ((1 - actual) - (1 - expected)));

    // Import as completed match record (for training)
    try {
      await prisma.match.create({
        data: {
          id: `hist_${m.date}_${m.home}_${m.away}`,
          matchDate: new Date(m.date),
          groupName: m.tournament,
          stage: 'HISTORICAL',
          homeTeamId: m.home,
          awayTeamId: m.away,
          status: 'completed',
          homeScore: m.hs,
          awayScore: m.as,
        },
      });
      imported++;
    } catch (e: any) {
      // Skip duplicates
      if (!e.message?.includes('Unique constraint')) console.log('Skip:', e.message?.slice(0, 80));
    }

    if (imported % 1000 === 0) console.log(`  imported ${imported}...`);
  }

  // Update team ELOs to historical values
  for (const [id, elo] of Object.entries(eloMap)) {
    await prisma.team.update({ where: { id }, data: { eloRating: elo } });
  }

  console.log(`\nImported ${imported} historical matches`);
  console.log('Updated 48 team ELOs from historical data');
  console.log('Sample ELOs:');
  const samples = ['arg', 'fra', 'bra', 'ger', 'jpn', 'ned', 'swe', 'civ'];
  for (const id of samples) console.log(`  ${id}: ${eloMap[id]}`);

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
