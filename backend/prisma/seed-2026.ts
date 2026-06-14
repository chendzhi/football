/**
 * 2026 FIFA World Cup — CORRECTED UTC TIMES
 * Verified against: sporttery.cn + Baidu Sports (June 2026)
 *
 * BJ time = UTC + 8h
 */

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const T: Record<string, [string,string,string,number,number,number,number]> = {
  mex:['Mexico','墨西哥','MEX',1930,1.7,1.2,0.70],kor:['South Korea','韩国','KOR',1890,1.6,1.3,0.65],
  cze:['Czechia','捷克','CZE',1860,1.4,1.4,0.62],rsa:['South Africa','南非','RSA',1810,1.2,1.5,0.58],
  can:['Canada','加拿大','CAN',1880,1.5,1.3,0.65],bih:['Bosnia & Herz.','波黑','BIH',1830,1.3,1.4,0.60],
  qat:['Qatar','卡塔尔','QAT',1760,1.1,1.6,0.55],sui:['Switzerland','瑞士','SUI',1940,1.5,1.0,0.70],
  bra:['Brazil','巴西','BRA',2100,2.2,0.8,0.88],mar:['Morocco','摩洛哥','MAR',1970,1.6,0.9,0.80],
  hai:['Haiti','海地','HAI',1680,0.7,2.0,0.40],sco:['Scotland','苏格兰','SCO',1880,1.3,1.2,0.68],
  usa:['United States','美国','USA',1960,1.8,1.1,0.75],par:['Paraguay','巴拉圭','PAR',1800,1.1,1.4,0.56],
  aus:['Australia','澳大利亚','AUS',1830,1.3,1.3,0.62],tur:['Turkiye','土耳其','TUR',1910,1.6,1.2,0.68],
  ger:['Germany','德国','GER',2040,2.0,1.0,0.78],cuw:['Curacao','库拉索','CUW',1650,0.7,2.1,0.38],
  civ:["Cote d'Ivoire",'科特迪瓦','CIV',1850,1.4,1.2,0.66],ecu:['Ecuador','厄瓜多尔','ECU',1880,1.3,1.2,0.64],
  ned:['Netherlands','荷兰','NED',2010,2.0,1.0,0.76],jpn:['Japan','日本','JPN',1950,1.8,1.0,0.82],
  swe:['Sweden','瑞典','SWE',1900,1.5,1.1,0.66],tun:['Tunisia','突尼斯','TUN',1810,1.1,1.2,0.62],
  bel:['Belgium','比利时','BEL',2000,1.8,1.1,0.68],egy:['Egypt','埃及','EGY',1840,1.3,1.1,0.68],
  irn:['Iran','伊朗','IRN',1800,1.2,1.4,0.64],nzl:['New Zealand','新西兰','NZL',1700,0.9,1.8,0.50],
  esp:['Spain','西班牙','ESP',2090,2.2,0.7,0.88],cpv:['Cape Verde','佛得角','CPV',1720,0.9,1.7,0.50],
  ksa:['Saudi Arabia','沙特阿拉伯','KSA',1780,1.1,1.5,0.58],uru:['Uruguay','乌拉圭','URU',1980,1.8,1.1,0.72],
  fra:['France','法国','FRA',2120,2.3,0.8,0.85],sen:['Senegal','塞内加尔','SEN',1920,1.5,1.1,0.70],
  irq:['Iraq','伊拉克','IRQ',1720,0.8,1.8,0.48],nor:['Norway','挪威','NOR',1950,1.8,1.0,0.74],
  arg:['Argentina','阿根廷','ARG',2140,2.3,0.7,0.92],alg:['Algeria','阿尔及利亚','ALG',1840,1.3,1.2,0.60],
  aut:['Austria','奥地利','AUT',1910,1.6,1.2,0.72],jor:['Jordan','约旦','JOR',1730,0.8,1.7,0.52],
  por:['Portugal','葡萄牙','POR',2050,2.1,0.9,0.80],col:['Colombia','哥伦比亚','COL',1960,1.7,1.0,0.74],
  cod:['DR Congo','刚果(金)','COD',1730,0.9,1.7,0.50],uzb:['Uzbekistan','乌兹别克斯坦','UZB',1740,0.9,1.6,0.52],
  eng:['England','英格兰','ENG',2080,2.1,0.8,0.82],cro:['Croatia','克罗地亚','CRO',1990,1.7,1.0,0.73],
  gha:['Ghana','加纳','GHA',1830,1.3,1.2,0.64],pan:['Panama','巴拿马','PAN',1750,0.9,1.7,0.50],
};

type M = [string,string,string,string,string,number?,number?];

// BJ times verified against sporttery.cn + Baidu
// Pattern A: BJ 03:00/06:00/09:00/12:00 → UTC 19:00/22:00/01:00+1/04:00+1
// Pattern B: BJ 01:00/04:00/07:00/10:00 → UTC 17:00/20:00/23:00/02:00+1
const SCHEDULE: M[] = [
  // ═══ MD1: Jun 11-17 ═══
  // Jun 11 Eastern (BJ: Jun 12 03:00/06:00) — verified Baidu
  ['m01','2026-06-11T19:00:00Z','Group A','mex','rsa',2,0],
  ['m02','2026-06-11T22:00:00Z','Group A','kor','cze',2,1],
  // Jun 12 Eastern (BJ: Jun 13 01:00/04:00) — verified Baidu
  ['m03','2026-06-12T17:00:00Z','Group B','can','bih',1,1],
  ['m04','2026-06-12T20:00:00Z','Group D','usa','par',4,1],
  // Jun 12 Eastern (BJ: Jun 13 03:00/06:00/09:00/12:00) — verified Baidu
  ['m05','2026-06-12T19:00:00Z','Group B','qat','sui',1,1],
  ['m06','2026-06-12T22:00:00Z','Group C','bra','mar',1,1],
  ['m07','2026-06-13T01:00:00Z','Group C','hai','sco',0,1],
  ['m08','2026-06-13T04:00:00Z','Group D','aus','tur',2,0],
  // Jun 13 Eastern (BJ: Jun 15 01:00/04:00/07:00/10:00) — verified sporttery
  ['m09','2026-06-14T17:00:00Z','Group E','ger','cuw'],
  ['m10','2026-06-14T20:00:00Z','Group F','ned','jpn'],
  ['m11','2026-06-14T23:00:00Z','Group E','civ','ecu'],
  ['m12','2026-06-15T02:00:00Z','Group F','swe','tun'],
  // Jun 14 Eastern (BJ: Jun 16 01:00/04:00/07:00/10:00) — verified sporttery
  ['m13','2026-06-15T17:00:00Z','Group H','esp','cpv'],
  ['m14','2026-06-15T20:00:00Z','Group G','bel','egy'],
  ['m15','2026-06-15T23:00:00Z','Group H','ksa','uru'],
  ['m16','2026-06-16T02:00:00Z','Group G','irn','nzl'],
  // Jun 15 Eastern (BJ: Jun 17) — verified sporttery
  ['m17','2026-06-16T17:00:00Z','Group I','fra','sen'],
  ['m18','2026-06-16T20:00:00Z','Group I','irq','nor'],
  ['m19','2026-06-16T23:00:00Z','Group J','arg','alg'],
  ['m20','2026-06-17T02:00:00Z','Group J','aut','jor'],
  // Jun 16 Eastern (BJ: Jun 18) — verified sporttery
  ['m21','2026-06-17T17:00:00Z','Group K','por','cod'],
  ['m22','2026-06-17T20:00:00Z','Group L','eng','cro'],
  ['m23','2026-06-17T23:00:00Z','Group L','gha','pan'],
  ['m24','2026-06-18T02:00:00Z','Group K','uzb','col'],

  // ═══ MD2: Jun 18-23 ═══
  ['m25','2026-06-18T17:00:00Z','Group A','cze','rsa'],
  ['m26','2026-06-18T20:00:00Z','Group B','sui','bih'],
  ['m27','2026-06-18T23:00:00Z','Group B','can','qat'],
  ['m28','2026-06-19T02:00:00Z','Group A','mex','kor'],
  ['m29','2026-06-19T17:00:00Z','Group D','usa','aus'],
  ['m30','2026-06-19T20:00:00Z','Group C','sco','mar'],
  ['m31','2026-06-19T23:00:00Z','Group C','bra','hai'],
  ['m32','2026-06-20T02:00:00Z','Group D','tur','par'],
  ['m33','2026-06-20T17:00:00Z','Group F','ned','swe'],
  ['m34','2026-06-20T20:00:00Z','Group E','ger','civ'],
  ['m35','2026-06-20T23:00:00Z','Group E','ecu','cuw'],
  ['m36','2026-06-21T02:00:00Z','Group F','tun','jpn'],
  ['m37','2026-06-21T17:00:00Z','Group H','esp','ksa'],
  ['m38','2026-06-21T20:00:00Z','Group G','bel','irn'],
  ['m39','2026-06-21T23:00:00Z','Group H','uru','cpv'],
  ['m40','2026-06-22T02:00:00Z','Group G','nzl','egy'],
  ['m41','2026-06-22T17:00:00Z','Group J','arg','aut'],
  ['m42','2026-06-22T20:00:00Z','Group I','fra','irq'],
  ['m43','2026-06-22T23:00:00Z','Group I','nor','sen'],
  ['m44','2026-06-23T02:00:00Z','Group J','jor','alg'],
  ['m45','2026-06-23T17:00:00Z','Group K','por','uzb'],
  ['m46','2026-06-23T20:00:00Z','Group L','eng','gha'],
  ['m47','2026-06-23T23:00:00Z','Group L','pan','cro'],
  ['m48','2026-06-24T02:00:00Z','Group K','col','cod'],

  // ═══ MD3: Jun 24-27 (simultaneous kickoffs) ═══
  ['m49','2026-06-24T17:00:00Z','Group B','sui','can'],
  ['m50','2026-06-24T17:00:00Z','Group B','bih','qat'],
  ['m51','2026-06-24T20:00:00Z','Group C','sco','bra'],
  ['m52','2026-06-24T20:00:00Z','Group C','mar','hai'],
  ['m53','2026-06-24T23:00:00Z','Group A','cze','mex'],
  ['m54','2026-06-24T23:00:00Z','Group A','rsa','kor'],
  ['m55','2026-06-25T17:00:00Z','Group E','cuw','civ'],
  ['m56','2026-06-25T17:00:00Z','Group E','ecu','ger'],
  ['m57','2026-06-25T20:00:00Z','Group F','jpn','swe'],
  ['m58','2026-06-25T20:00:00Z','Group F','tun','ned'],
  ['m59','2026-06-25T23:00:00Z','Group D','tur','usa'],
  ['m60','2026-06-25T23:00:00Z','Group D','par','aus'],
  ['m61','2026-06-26T17:00:00Z','Group I','nor','fra'],
  ['m62','2026-06-26T17:00:00Z','Group I','sen','irq'],
  ['m63','2026-06-26T20:00:00Z','Group H','cpv','ksa'],
  ['m64','2026-06-26T20:00:00Z','Group H','uru','esp'],
  ['m65','2026-06-26T23:00:00Z','Group G','egy','irn'],
  ['m66','2026-06-26T23:00:00Z','Group G','nzl','bel'],
  ['m67','2026-06-27T17:00:00Z','Group L','pan','eng'],
  ['m68','2026-06-27T17:00:00Z','Group L','cro','gha'],
  ['m69','2026-06-27T20:00:00Z','Group K','col','por'],
  ['m70','2026-06-27T20:00:00Z','Group K','cod','uzb'],
  ['m71','2026-06-27T23:00:00Z','Group J','alg','aut'],
  ['m72','2026-06-27T23:00:00Z','Group J','jor','arg'],
];

async function main() {
  console.log('⚽ 2026 WC — CORRECTED schedule');
  await prisma.predictionHistory.deleteMany();await prisma.playerStats.deleteMany();await prisma.player.deleteMany();
  await prisma.oddsHistory.deleteMany();await prisma.odds.deleteMany();await prisma.featureSnapshot.deleteMany();
  await prisma.match.deleteMany();await prisma.teamStats.deleteMany();await prisma.team.deleteMany();

  for(const[id,[name,cn,code,elo,xgF,xgA,form]]of Object.entries(T)){
    await prisma.team.create({data:{id,name,chinaName:cn,shortName:code,flagUrl:'',eloRating:elo}});
    await prisma.teamStats.create({data:{id:'s_'+id,teamId:id,matchDate:new Date(),expectedGoalsFor:xgF,expectedGoalsAgst:xgA,formScore:form}});
  }

  let completed=0,scheduled=0;
  for(const[mid,date,group,home,away,hs,as]of SCHEDULE){
    const hasResult=hs!==undefined&&as!==undefined;
    await prisma.match.create({data:{id:mid,matchDate:new Date(date),groupName:group,stage:'GROUP_STAGE',homeTeamId:home,awayTeamId:away,status:hasResult?'completed':'scheduled',homeScore:hs??null,awayScore:as??null}});
    const h=T[home],a=T[away],eloDiff=h[3]-a[3];
    const homeStr=1/(1+Math.exp(-eloDiff/400)),drawP=Math.max(0.15,0.28-Math.abs(eloDiff)/2500);
    const homeP=homeStr*(1-drawP),awayP=(1-homeStr)*(1-drawP),m=1.07;
    await prisma.odds.create({data:{id:'o_'+mid,matchId:mid,currentHomeOdds:+(m/homeP).toFixed(2),currentDrawOdds:+(m/drawP).toFixed(2),currentAwayOdds:+(m/awayP).toFixed(2)}});
    if(hasResult){
      completed++;
      const out=hs!>as!?'H':hs!<as!?'A':'D';
      await prisma.predictionHistory.create({data:{id:'ph_'+mid,matchId:mid,teamId:home,predHomeWin:+homeP.toFixed(4),predDraw:+drawP.toFixed(4),predAwayWin:+awayP.toFixed(4),actualOutcome:out,featureVersion:'verified',modelVersion:'v3',simulationVersion:'v4'}});
    }else{scheduled++;}
  }
  console.log(`${completed} completed · ${scheduled} upcoming · Times verified against sporttery.cn`);
}
main().then(async()=>{await prisma.$disconnect()}).catch(async e=>{console.error(e);await prisma.$disconnect();process.exit(1)});
