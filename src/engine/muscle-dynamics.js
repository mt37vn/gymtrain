function computeEpley1RM(weight, reps) {
  if (reps <= 0 || weight <= 0) return 0;
  return weight * (1 + reps / 30);
}

function computeCatabolism(prevM, dailyTSS, params) {
  const lambda_cat = params.lambda_base
    + (params.lambda_max - params.lambda_base) * Math.min(1, dailyTSS / params.tss_crit);
  return prevM * lambda_cat;
}

function computeAnabolism(sets, currentPR, params) {
  if (!sets || sets.length === 0 || currentPR <= 0) return 0;

  let S = 0;
  for (const set of sets) {
    const intensity = set.weight / currentPR;
    const impulse = params.k_anabolic * Math.pow(intensity, params.alpha_intensity);
    S += impulse;
  }
  return S;
}

function computeAnabolismA(S, prevM, params) {
  if (prevM <= 0) return 0;
  return Math.min(params.a_max, S / prevM);
}

function updateM(prevM, catabolism, anabolismA, params) {
  return Math.max(params.m_min, prevM - catabolism + anabolismA);
}

function checkPlateau(newM, m7DaysAgo) {
  if (m7DaysAgo === null || m7DaysAgo === undefined) return false;
  return newM <= m7DaysAgo;
}

function compute1RM(PR, M, weightMult) {
  return PR * Math.pow(M, 1.5) * weightMult;
}

module.exports = {
  computeEpley1RM,
  computeCatabolism,
  computeAnabolism,
  computeAnabolismA,
  updateM,
  checkPlateau,
  compute1RM
};
