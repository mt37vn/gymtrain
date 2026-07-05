function computeSetTSS(weight, reps, rm1Pred) {
  if (rm1Pred <= 0 || weight <= 0 || reps <= 0) return 0;
  if (weight >= rm1Pred) return weight * Math.sqrt(10 / reps);
  const maxReps = Math.floor(30 * (rm1Pred / weight - 1));
  if (maxReps < 1) return weight * Math.sqrt(10 / reps);
  const ratio = Math.min(reps, maxReps) / maxReps;
  const effReps = Math.min(reps, maxReps);
  return weight * ratio * Math.sqrt(10 / effReps);
}

function computeDailyTSS(sets, getRm1Pred) {
  if (!sets || sets.length === 0) return 0;
  let total = 0;
  for (const set of sets) {
    const rm1 = getRm1Pred(set.exercise);
    total += computeSetTSS(set.weight, set.reps, rm1);
  }
  return total;
}

function computeSMA(values, window) {
  if (!values || values.length === 0) return 0;
  const count = Math.min(values.length, window);
  const slice = values.slice(values.length - count);
  return slice.reduce((a, b) => a + b, 0) / count;
}

function checkDeload(fitness, fatigue, thresholdPct) {
  if (fitness <= 0) return 0;
  const tsb = fitness - fatigue;
  const th = (thresholdPct || -20) / 100;
  if (tsb < th * fitness) return 1;
  if (tsb < -30) return 1;
  return 0;
}

module.exports = {
  computeSetTSS,
  computeDailyTSS,
  computeSMA,
  checkDeload
};
