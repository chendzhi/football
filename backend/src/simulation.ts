/**
 * Simulation v4 — Phase 2 Enhanced
 *
 * New:
 *   - lambda noise perturbation N(0, 0.08)
 *   - Low-score weight correction
 *   - Dixon-Coles rho=0.12
 *   - Clamped lambda in [0.2, 3.5]
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
  return Math.max(0.1, Math.min(5.0, lambda*(1+normalRandom()*0.08)));
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
}

export function runMonteCarloSimulation(
  home:RawTeamFeatures, away:RawTeamFeatures, _odds:RawOddsFeatures|null
): SimulationReport {
  const li: LambdaInput = {
    homeAttack:home.expectedGoalsFor, awayAttack:away.expectedGoalsFor,
    homeDefense:home.expectedGoalsAgst, awayDefense:away.expectedGoalsAgst,
    homeForm:home.formScore, awayForm:away.formScore,
    homeElo:home.eloRating, awayElo:away.eloRating,
    homeAdvantage:1.1,
  };
  const b = computeLambda(li);
  const bH = Math.max(0.2, b.homeLambda);
  const bA = Math.max(0.2, b.awayLambda);

  const N=10000, sp=roundQuarter((bH-bA)*0.6), maxT=dixonColesMaxTau(bH,bA);
  let hW=0,d=0,aW=0,o25=0,cov=0,psh=0,acc=0;
  const sm=new Map<string,number>();
  const sl=slots();

  while(acc<N) {
    const lH=perturb(bH), lA=perturb(bA);
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

  const rH=hW/acc,rD=d/acc,rA=aW/acc;
  // Noise floor: 8% reserved for randomness → prevents overconfidence
  const NOISE=0.08;
  const sH=rH*(1-NOISE)+NOISE/3, sD=rD*(1-NOISE)+NOISE/3, sA=rA*(1-NOISE)+NOISE/3;
  const sum=sH+sD+sA;
  const fH=sH/sum, fD=sD/sum, fA=sA/sum;

  // Apply calibration to noise-smoothed probs
  const ap=(p:number)=>{const i=getIsotonic().calibrate(p);return Math.abs(i-p)>0.001?i:getCalibrator().calibrate(p)};
  const[cH,cD,cA]=[ap(fH),ap(fD),ap(fA)],cs=cH+cD+cA;

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
  };
}
