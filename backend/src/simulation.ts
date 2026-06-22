/**
 * Simulation v5 — Market-Driven Hybrid
 *
 * New:
 *   - Odds-driven lambdas (market is the best predictor)
 *   - Wider perturbation N(0, 0.15) for score diversity
 *   - Dixon-Coles rho=-0.25 (stronger low-score draw correction)
 *   - Clamped lambda in [0.1, 6.0]
 */

import { RawTeamFeatures, RawOddsFeatures } from './types';
import { dixonColesTau, dixonColesMaxTau, lowScoreWeight } from './dixon_coles';
import { computeLambda, LambdaInput } from './feature';
import { getCalibrator, getIsotonic, getPerScoreCalibrator } from './calibration/calibration';

function poissonSample(L: number): number {
  const l = Math.exp(-Math.max(L, 0.01)); let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > l);
  return k - 1;
}
function roundQuarter(v: number): number { return Math.round(v * 4) / 4; }
function normalRandom(): number {
  let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
}
function perturb(lambda: number): number {
  return Math.max(0.05, Math.min(7.0, lambda*(1+normalRandom()*0.15)));
}

interface Slot { minute:number;weight:number;fatigue:number;momentum:number }
function slots(): Slot[] {
  return Array.from({length:9},(_,i)=>({
    minute:i*10,weight:10/90,
    fatigue:i<6?1.0:Math.max(0.75,1.0-(i-6)*0.008),momentum:0
  }));
}

export interface SimulationReport {
  lambdas: { homeLambda:number; awayLambda:number };
  probabilities: { homeWin:number;draw:number;awayWin:number;rawHomeWin?:number;rawDraw?:number;rawAwayWin?:number };
  topScores: Array<{score:string;prob:string}>;
  over25Prob:number; under25Prob:number;
  spread: { line:number; coverProb:number };
  confidence:number;
  _scoreMap: Record<string,number>;  // score → count map for script tree
}

export function runMonteCarloSimulation(
  home:RawTeamFeatures, away:RawTeamFeatures, odds:RawOddsFeatures|null,
  mlLambdas?: { homeLambda: number; awayLambda: number } | null
): SimulationReport {
  const li: LambdaInput = {
    homeAttack:home.expectedGoalsFor, awayAttack:away.expectedGoalsFor,
    homeDefense:home.expectedGoalsAgst, awayDefense:away.expectedGoalsAgst,
    homeForm:home.formScore, awayForm:away.formScore,
    homeElo:home.eloRating, awayElo:away.eloRating,
    homeAdvantage:1.1,
  };

  // ML model takes priority; fall back to hardcoded computeLambda
  let bH: number, bA: number;
  if (mlLambdas) {
    bH = Math.max(0.1, mlLambdas.homeLambda);
    bA = Math.max(0.1, mlLambdas.awayLambda);
  } else {
    const b = computeLambda(li);
    bH = Math.max(0.1, b.homeLambda);
    bA = Math.max(0.1, b.awayLambda);
  }

  // ── Dynamic hyperparameters ──
  const _lambdaGap = Math.abs(bH - bA);
  const totalLambda = bH + bA;
  // Perturbation: larger gap → less noise, smaller gap → more noise
  const dynNoise = 0.08 + 0.12 * Math.exp(-_lambdaGap * 0.8);
  // Time slots: more goals → finer granularity
  const slotCount = totalLambda > 4 ? 12 : totalLambda > 2.5 ? 9 : 6;
  const slotMinutes = 90 / slotCount;
  const dynSlots = (): Slot[] => Array.from({length: slotCount}, (_, i) => ({
    minute: i * slotMinutes,
    weight: slotMinutes / 90,
    fatigue: i < slotCount * 0.65 ? 1.0 : Math.max(0.75, 1.0 - (i - slotCount * 0.65) * 0.008),
    momentum: 0,
  }));

  const N=10000, sp=roundQuarter((bH-bA)*0.6), maxT=dixonColesMaxTau(bH,bA);
  let hW=0,d=0,aW=0,o25=0,cov=0,psh=0,acc=0;
  const sm=new Map<string,number>();
  const sl=dynSlots();

  while(acc<N) {
    const lH=Math.max(0.05, Math.min(7.0, bH * (1 + normalRandom() * dynNoise)));
    const lA=Math.max(0.05, Math.min(7.0, bA * (1 + normalRandom() * dynNoise)));
    let hg=0,ag=0;
    for(const s of sl) {
      const f=10/90;
      const h=poissonSample(lH*f*s.fatigue*(1+s.momentum));
      const a=poissonSample(lA*f*s.fatigue*(1-s.momentum));
      hg+=h; ag+=a;
      if(h>a)s.momentum+=0.05;else if(a>h)s.momentum-=0.05;
      s.momentum=Math.max(-0.3,Math.min(0.3,s.momentum));
    }
    const tau=dixonColesTau(hg,ag,lH,lA);
    if(Math.random()>tau/maxT) continue;
    acc++;
    if(hg>ag)hW++;else if(hg<ag)aW++;else d++;
    if(hg+ag>2.5)o25++;
    const adj=hg-ag-sp; if(adj>0)cov++;else if(adj===0)psh++;
    const k=`${hg}-${ag}`;
    sm.set(k,(sm.get(k)||0)+lowScoreWeight(k,lH,lA));
  }

  // ── Post-simulation draw boost ──
  // When lambdas are close, draws are much more likely than Poisson suggests
  const lambdaGap = Math.abs(bH - bA);
  if (lambdaGap < 1.5) {
    const drawBoost = Math.exp(-lambdaGap * 2.0); // 1.0 at gap=0, 0.14 at gap=1.0, 0.05 at gap=1.5
    const extraDraws = Math.round(acc * drawBoost * 0.25);
    d += extraDraws;
    acc += extraDraws;
    // Boost 0-0 and 1-1 in score distribution
    const boost00 = (sm.get('0-0') || 0) * (1 + drawBoost * 4);
    const boost11 = (sm.get('1-1') || 0) * (1 + drawBoost * 3);
    const boost22 = (sm.get('2-2') || 0) * (1 + drawBoost * 2);
    if (sm.has('0-0')) sm.set('0-0', boost00);
    if (sm.has('1-1')) sm.set('1-1', boost11);
    if (sm.has('2-2')) sm.set('2-2', boost22);
  }

  const rH=hW/acc,rD=d/acc,rA=aW/acc;
  // Noise floor: 8% reserved for randomness → prevents overconfidence
  const NOISE=0.08;
  const sH=rH*(1-NOISE)+NOISE/3, sD=rD*(1-NOISE)+NOISE/3, sA=rA*(1-NOISE)+NOISE/3;
  const sum=sH+sD+sA;
  const fH=sH/sum, fD=sD/sum, fA=sA/sum;

  // Apply calibration to noise-smoothed probs
  const ap=(p:number)=>{const i=getIsotonic().calibrate(p);return Math.abs(i-p)>0.001?i:getCalibrator().calibrate(p)};
  let[cH,cD,cA]=[ap(fH),ap(fD),ap(fA)],cs=cH+cD+cA;

  // ── Market probability anchor ──
  // Blend simulation probabilities toward market-implied when odds available
  let marketBlend = 0;
  if (odds) {
    const mar = 1/odds.homeOdds + 1/odds.drawOdds + 1/odds.awayOdds;
    if (mar > 1 && mar < 1.3) {
      const mpH = (1/odds.homeOdds) / mar;
      const mpD = (1/odds.drawOdds) / mar;
      const mpA = (1/odds.awayOdds) / mar;
      // 70% market + 30% simulation
      const MB = 0.70;
      const simH = cs > 0 ? cH/cs : fH;
      const simD = cs > 0 ? cD/cs : fD;
      const simA = cs > 0 ? cA/cs : fA;
      cH = MB * mpH + (1-MB) * simH;
      cD = MB * mpD + (1-MB) * simD;
      cA = MB * mpA + (1-MB) * simA;
      cs = cH + cD + cA;
      marketBlend = MB;
    }
  }

  const ts=[...sm.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3)
    .map(([sc,c])=>({score:sc,prob:((c/acc)*100).toFixed(1)}));

  // O/U from score matrix (not separate counter — ensures data consistency)
  let overFromMatrix=0, totalWeight=0;
  for(const [score,weight] of sm) {
    const [h,a]=score.split('-').map(Number);
    totalWeight+=weight;
    if(h+a>2.5) overFromMatrix+=weight;
  }
  const rOH2=totalWeight>0?overFromMatrix/totalWeight:o25/acc;
  const sOH=rOH2*(1-NOISE)+NOISE/2, sUH=(1-rOH2)*(1-NOISE)+NOISE/2;

  return {
    lambdas:{homeLambda:bH,awayLambda:bA},
    probabilities:{
      homeWin:parseFloat((cs>0?cH/cs:fH).toFixed(3)),
      draw:parseFloat((cs>0?cD/cs:fD).toFixed(3)),
      awayWin:parseFloat((cs>0?cA/cs:fA).toFixed(3)),
      rawHomeWin:parseFloat(rH.toFixed(3)),rawDraw:parseFloat(rD.toFixed(3)),rawAwayWin:parseFloat(rA.toFixed(3)),
    },
    topScores:ts,
    over25Prob:parseFloat(sOH.toFixed(3)),
    under25Prob:parseFloat(sUH.toFixed(3)),
    spread:{line:sp,coverProb:psh<acc?parseFloat((cov/(acc-psh)).toFixed(3)):0.5},
    confidence:parseFloat((Math.max(hW,d,aW)/acc).toFixed(3)),
    _scoreMap: Object.fromEntries(sm),
  };
}
