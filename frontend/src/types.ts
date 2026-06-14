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
