const LAMBDA_BASE = 0.001;
const LAMBDA_MAX = 0.002;
const TSS_CRIT = 200;
const A_MAX = 0.002;
const K = 0.0005;
const ALPHA = 5;
const M_MIN = 0.01;

function computeEpley1RM(weight, reps) {
  if (reps <= 0 || weight <= 0) return 0;
  return weight * (1 + reps / 30);
}

function computeCatabolism(prevM, dailyTSS) {
  const lambda_cat = LAMBDA_BASE + (LAMBDA_MAX - LAMBDA_BASE) * Math.min(1, dailyTSS / TSS_CRIT);
  return prevM * lambda_cat;
}

function computeAnabolism(sets, currentPR) {
  if (!sets || sets.length === 0 || currentPR <= 0) return 0;

  let S = 0;
  for (const set of sets) {
    const intensity = set.weight / currentPR;
    const impulse = K * Math.pow(intensity, ALPHA);
    S += impulse;
  }
  return S;
}

function computeAnabolismA(S, prevM) {
  if (prevM <= 0) return 0;
  return Math.min(A_MAX, S / prevM);
}

function updateM(prevM, catabolism, anabolismA) {
  return Math.max(M_MIN, prevM - catabolism + anabolismA);
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
  compute1RM,
  M_MIN,
  LAMBDA_BASE,
  LAMBDA_MAX,
  TSS_CRIT,
  A_MAX,
  K,
  ALPHA
};
