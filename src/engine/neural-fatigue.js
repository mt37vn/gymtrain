function computeSetTSS(weight, reps, rm1Pred, params) {
  if (rm1Pred <= 0 || weight <= 0 || reps <= 0) return 0;

  const ratio = rm1Pred / weight;
  let M_max = 30 * (ratio - 1);
  M_max = Math.min(M_max, params.m_max_cap);
  if (M_max <= 0) return 0;

  if (reps <= M_max) {
    return weight * (reps / M_max);
  }
  return weight * (1 + params.k_failure * (reps - M_max) / M_max);
}

function computeDailyTSS(sets, rm1Pred, params) {
  if (!sets || sets.length === 0) return 0;
  return sets.reduce((sum, set) => sum + computeSetTSS(set.weight, set.reps, rm1Pred, params), 0);
}

function computeCTL(prevCTL, dailyTSS, params) {
  const alphaCTL = 1 - Math.exp(-1 / params.tau_ctl_days);
  return prevCTL + alphaCTL * (dailyTSS - prevCTL);
}

function computeATL(prevATL, dailyTSS, params) {
  const alphaATL = 1 - Math.exp(-1 / params.tau_atl_days);
  return prevATL + alphaATL * (dailyTSS - prevATL);
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
  checkDeload
};
