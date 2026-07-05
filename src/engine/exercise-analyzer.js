const db = require('../database');
const {
  computeCatabolism, computeAnabolism, computeAnabolismA,
  updateM, checkPlateau, compute1RM, computeEpley1RM
} = require('./muscle-dynamics');

const { getParams } = require('../params');

function analyzeExercise(exercise) {
  const params = getParams();
  const dayKeys = db.getAllDayKeysForExercise(exercise);
  if (dayKeys.length === 0) return [];

  const range = db.getFirstAndLastDay();
  const firstDate = new Date(range.firstDay + 'T00:00:00Z');
  const lastDate = new Date(range.lastDay + 'T00:00:00Z');
  const totalDays = Math.round((lastDate - firstDate) / (1000 * 60 * 60 * 24)) + 1;

  const trainingDaySet = new Set(dayKeys.map(d => d.day_key));
  const results = [];

  let prevM = 1.0;
  let prevWeightMult = 1.0;
  const mHistory = [];

  const epleyWindow = [];

  for (let i = 0; i < totalDays; i++) {
    const currentDate = new Date(firstDate);
    currentDate.setDate(firstDate.getDate() + i);
    const dayKey = currentDate.toISOString().slice(0, 10);
    const isTrainingDay = trainingDaySet.has(dayKey);

    const dailyTSS = db.getDailyTSSForDay(dayKey);
    const C = computeCatabolism(prevM, dailyTSS, params);

    let A = 0;
    let sets = [];
    let totalSets = 0;
    let currentPR = 0;
    let plateauHit = 0;
    let currentWeightMult = prevWeightMult;

    /* Compute current PR from the sliding window */
    const cutoffDate = new Date(currentDate);
    cutoffDate.setDate(cutoffDate.getDate() - params.pr_window_days);
    const cutoffKey = cutoffDate.toISOString().slice(0, 10);
    while (epleyWindow.length > 0 && epleyWindow[0].dayKey < cutoffKey) {
      epleyWindow.shift();
    }
    currentPR = epleyWindow.length > 0
      ? Math.max(...epleyWindow.map(e => e.epley))
      : 0;

    if (isTrainingDay) {
      sets = db.getSetsByDayAndExercise(dayKey, exercise);
      totalSets = sets.length;

      const maxEpley = sets.reduce((max, s) => {
        const ep = computeEpley1RM(s.weight, s.reps);
        return ep > max ? ep : max;
      }, 0);

      if (currentPR === 0 && maxEpley > 0) {
        currentPR = maxEpley;
      }

      if (currentPR > 0) {
        const S = computeAnabolism(sets, currentPR, params);
        A = computeAnabolismA(S, prevM, params);
      }
    }

    const newM = updateM(prevM, C, A, params);

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

      const todaysMax = sets.reduce((max, s) => {
        const ep = computeEpley1RM(s.weight, s.reps);
        return ep > max ? ep : max;
      }, 0);
      if (todaysMax > 0) {
        epleyWindow.push({ dayKey, epley: todaysMax });
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
    prevWeightMult = currentWeightMult;
  }

  return results;
}

module.exports = { analyzeExercise };
