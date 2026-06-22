export const VERSIONS = {
  feature: 'v4_hybrid',
  model: 'v4_dixon_coles_mc',
  simulation: 'v4_10k_trials',
} as const;

let _trainCycle = 0;

/** Call after each retrain to bump version automatically */
export function bumpModelVersion(): string {
  _trainCycle++;
  return `v4_hybrid_t${_trainCycle}`;
}

export function getTrainCycle(): number {
  return _trainCycle;
}
