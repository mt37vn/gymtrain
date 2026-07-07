function computeEpley1RM(weight, reps) {
  if (reps <= 0 || weight <= 0) return 0;
  return weight * (1 + reps / 30);
}

function computeWeightAtRIR(pre, reps, rirPct) {
  if (pre <= 0 || reps <= 0) return 0;
  const rirReps = Math.round(reps * rirPct);
  return Math.round(pre * 30 / (30 + reps + rirReps) * 10) / 10;
}

module.exports = {
  computeEpley1RM,
  computeWeightAtRIR
};
