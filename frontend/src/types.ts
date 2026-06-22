export interface Team {
  id: string;
  name: string;
  chinaName: string;
  shortName: string;
  flagUrl: string;
  eloRating: number;
}

export interface Match {
  id: string;
  matchDate: string;
  groupName: string;
  stage: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam: Team;
  awayTeam: Team;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
}

export interface SimulationReport {
  lambdas: {
    homeLambda: number;
    awayLambda: number;
  };
  probabilities: {
    homeWin: number;
    draw: number;
    awayWin: number;
    rawHomeWin?: number;
    rawDraw?: number;
    rawAwayWin?: number;
  };
  topScores: Array<{ score: string; prob: string }>;
  over25Prob: number;
  under25Prob: number;
  spread: {
    line: number;
    coverProb: number;
  };
  confidence: number;
}

export interface SimMeta {
  engine: string;
  correction: string;
  calibration: string;
  marketBlend: string;
  lambdaVersion: string;
  oddsMonitoring?: {
    implied: number;
    delta: number;
    velocity: number;
    pressure: number;
    live: boolean;
  } | null;
}

/** Explain Engine API 返回结构 */
export interface ExplainResponse {
  matchId: string;
  lambdaBreakdown: {
    home: {
      final: number;
      base: number;
      details: Array<{
        component: string;
        rawValue: number;
        logContribution: number;
        absoluteContribution: number;
        percentage: number;
      }>;
    };
    away: {
      final: number;
      base: number;
      details: Array<{
        component: string;
        rawValue: number;
        logContribution: number;
        absoluteContribution: number;
        percentage: number;
      }>;
    };
  };
  poissonMatrix: {
    matrix: number[][];
    displayMatrix: number[][];
    regionIndicators: string[][];
    homeMarginal: number[];
    awayMarginal: number[];
  };
  poissonDist: {
    home: number[];
    away: number[];
  };
  featureContribution: {
    features: Array<{
      feature: string;
      featureKey: string;
      baseProb: { homeWin: number; draw: number; awayWin: number };
      perturbUp: { homeWin: number; draw: number; awayWin: number };
      perturbDown: { homeWin: number; draw: number; awayWin: number };
      deltaHomeWin: number;
      deltaDraw: number;
      deltaAwayWin: number;
      maxAbsoluteDelta: number;
    }>;
    homeWinTopContributors: Array<{
      feature: string;
      deltaHomeWin: number;
    }>;
    drawTopContributors: Array<{
      feature: string;
      deltaDraw: number;
    }>;
    awayWinTopContributors: Array<{
      feature: string;
      deltaAwayWin: number;
    }>;
  };
  halfTimeScenarios?: {
    scenarios: Array<{
      halfScore: string;
      halfHome: number;
      halfAway: number;
      halfProb: number;
      fullScore: string;
      fullProb: number;
      narrative: string;
    }>;
    homeLambdaHT: number;
    awayLambdaHT: number;
  };
  pipelineLogs: string[];
}
