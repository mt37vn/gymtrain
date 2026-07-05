const ALPHA_CTL = 1 - Math.exp(-1 / 42);
const ALPHA_ATL = 1 - Math.exp(-1 / 7);
const M_MAX_CAP = 40;

function computeSetTSS(weight, reps, rm1Pred) {
  if (rm1Pred <= 0 || weight <= 0 || reps <= 0) return 0;

  const ratio = rm1Pred / weight;
  let M_max = 30 * (ratio - 1);
  M_max = Math.min(M_max, M_MAX_CAP);
  if (M_max <= 0) return 0;

  if (reps <= M_max) {
    return weight * (reps / M_max);
  }
  return weight * (1 + 2 * (reps - M_max) / M_max);
}

function computeDailyTSS(sets, rm1Pred) {
  if (!sets || sets.length === 0) return 0;
  return sets.reduce((sum, set) => sum + computeSetTSS(set.weight, set.reps, rm1Pred), 0);
}

function computeCTL(prevCTL, dailyTSS) {
  return prevCTL + ALPHA_CTL * (dailyTSS - prevCTL);
}

function computeATL(prevATL, dailyTSS) {
  return prevATL + ALPHA_ATL * (dailyTSS - prevATL);
}

function computeTSB(ctl, atl) {
  return ctl - atl;
}

function checkDeload(ctl, atl, tsb) {
  if (ctl > 0 && tsb < -0.25 * ctl) return 1;
  if (tsb < -50) return 1;
  return 0;
}

module.exports = {
  computeSetTSS,
  computeDailyTSS,
  computeCTL,
  computeATL,
  computeTSB,
  checkDeload,
  ALPHA_CTL,
  ALPHA_ATL
};
