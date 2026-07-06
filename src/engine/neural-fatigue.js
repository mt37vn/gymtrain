function computeSetTSS(weight, reps, bodyweight) {
  if (bodyweight <= 0 || weight <= 0 || reps <= 0) return 0;
  const rm1 = weight * (1 + reps / 30);
  return (rm1 * rm1) / bodyweight;
}

function computeDailyTSS(sets, bodyweight) {
  if (!sets || sets.length === 0) return 0;
  let total = 0;
  for (const set of sets) {
    total += computeSetTSS(set.weight, set.reps, bodyweight);
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
  return 0;
}

module.exports = {
  computeSetTSS,
  computeDailyTSS,
  computeSMA,
  checkDeload
};
