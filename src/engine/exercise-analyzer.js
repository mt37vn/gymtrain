const db = require('../database');
const {
  computeCatabolism, computeAnabolism, computeAnabolismA,
  updateM, checkPlateau, compute1RM, computeEpley1RM
} = require('./muscle-dynamics');

function analyzeExercise(exercise) {
  const dayKeys = db.getAllDayKeysForExercise(exercise);
  if (dayKeys.length === 0) return [];

  const range = db.getFirstAndLastDay();
  const firstDate = new Date(range.firstDay + 'T00:00:00Z');
  const lastDate = new Date(range.lastDay + 'T00:00:00Z');
  const totalDays = Math.round((lastDate - firstDate) / (1000 * 60 * 60 * 24)) + 1;

  const trainingDaySet = new Set(dayKeys.map(d => d.day_key));
  const results = [];

  let prevM = 1.0;
  let prevPR = 0;
  let prevWeightMult = 1.0;
  const mHistory = [];

  for (let i = 0; i < totalDays; i++) {
    const currentDate = new Date(firstDate);
    currentDate.setDate(firstDate.getDate() + i);
    const dayKey = currentDate.toISOString().slice(0, 10);
    const isTrainingDay = trainingDaySet.has(dayKey);

    const dailyTSS = db.getDailyTSSForDay(dayKey);
    const C = computeCatabolism(prevM, dailyTSS);

    let A = 0;
    let sets = [];
    let totalSets = 0;
    let currentPR = prevPR;
    let plateauHit = 0;
    let currentWeightMult = prevWeightMult;

    if (isTrainingDay) {
      sets = db.getSetsByDayAndExercise(dayKey, exercise);
      totalSets = sets.length;

      const maxEpley = sets.reduce((max, s) => {
        const ep = computeEpley1RM(s.weight, s.reps);
        return ep > max ? ep : max;
      }, 0);

      if (prevPR === 0 && maxEpley > 0) {
        currentPR = maxEpley;
      }

      if (currentPR > 0) {
        const S = computeAnabolism(sets, currentPR);
        A = computeAnabolismA(S, prevM);
      }
    }

    const newM = updateM(prevM, C, A);

    if (isTrainingDay) {
      for (const set of sets) {
        const ep = computeEpley1RM(set.weight, set.reps);
        if (ep > currentPR) {
          currentPR = ep;
        }
      }

      const m7ago = mHistory[mHistory.length - 7] ?? null;
      if (checkPlateau(newM, m7ago)) {
        plateauHit = 1;
        currentWeightMult = currentWeightMult * 1.05;
      }
    }

    const rm1Pred = compute1RM(currentPR, newM, currentWeightMult);

    results.push({
      day_key: dayKey,
      daily_tss: dailyTSS,
      m: newM,
      pr: currentPR,
      weight_mult: currentWeightMult,
      rm1_predicted: rm1Pred,
      plateau_hit: plateauHit,
      anabolism: A,
      catabolism: C,
      total_sets: totalSets
    });

    mHistory.push(newM);
    prevM = newM;
    prevPR = currentPR;
    prevWeightMult = currentWeightMult;
  }

  return results;
}

module.exports = { analyzeExercise };
