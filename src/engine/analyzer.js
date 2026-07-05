const {
  computeDailyTSS, computeCTL, computeATL, computeTSB, checkDeload
} = require('./neural-fatigue');
const {
  computeEpley1RM, computeCatabolism, computeAnabolism,
  computeAnabolismA, updateM, checkPlateau, compute1RM
} = require('./muscle-dynamics');
const db = require('../database');
const { getParams } = require('../params');

function msToDayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayKeyToDate(dk) {
  return new Date(dk + 'T00:00:00Z');
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function daysBetween(d1, d2) {
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function runAnalysis() {
  const params = getParams();

  const dayKeys = db.getAllDayKeys();
  if (dayKeys.length === 0) {
    console.log('No data to analyze.');
    return;
  }

  const firstDate = dayKeyToDate(dayKeys[0].day_key);
  const lastDate = dayKeyToDate(dayKeys[dayKeys.length - 1].day_key);
  const totalCalendarDays = daysBetween(firstDate, lastDate) + 1;

  console.log(`Analysis range: ${formatDate(firstDate)} to ${formatDate(lastDate)} (${totalCalendarDays} calendar days)`);

  let prevM = 1.0;
  let prevPR = 0;
  let prevWeightMult = 1.0;
  let prevCTL = 0;
  let prevATL = 0;
  let prev1RMPred = 0;

  const mHistory = [];
  let trainingDayIndex = 0;
  let restDayIndex = 0;

  const allDayKeys = new Set(dayKeys.map(d => d.day_key));

  for (let i = 0; i < totalCalendarDays; i++) {
    const currentDate = new Date(firstDate);
    currentDate.setDate(firstDate.getDate() + i);
    const dayKey = formatDate(currentDate);
    const isTrainingDay = allDayKeys.has(dayKey);

    let dailyTSS = 0;
    let sets = [];
    let totalSets = 0;
    let C = 0;
    let S = 0;
    let A = 0;
    let currentPR = prevPR;
    let currentWeightMult = prevWeightMult;
    let plateauHit = 0;
    let deloadWarning = 0;
    let newM = prevM;
    let new1RMPred = 0;

    if (isTrainingDay) {
      sets = db.getSetsByDay(dayKey);
      totalSets = sets.length;

      const maxEpley = sets.reduce((max, s) => {
        const ep = computeEpley1RM(s.weight, s.reps);
        return ep > max ? ep : max;
      }, 0);

      if (prevPR === 0 && maxEpley > 0) {
        currentPR = maxEpley;
        prevPR = currentPR;
      }

      dailyTSS = computeDailyTSS(sets, prev1RMPred, params);
      if (prev1RMPred <= 0) {
        dailyTSS = computeDailyTSS(sets, currentPR, params);
      }

      C = computeCatabolism(prevM, dailyTSS, params);

      if (currentPR > 0) {
        S = computeAnabolism(sets, currentPR, params);
        A = computeAnabolismA(S, prevM, params);
      }

      newM = updateM(prevM, C, A, params);

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
        db.insertPlateauEvent({ day_key: dayKey, old_mult: prevWeightMult, new_mult: currentWeightMult });
      }

      new1RMPred = compute1RM(currentPR, newM, currentWeightMult);

      deloadWarning = checkDeload(prevCTL, prevATL, prevCTL - prevATL);
      const newCTL = computeCTL(prevCTL, dailyTSS, params);
      const newATL = computeATL(prevATL, dailyTSS, params);
      const newTSB = computeTSB(newCTL, newATL);
      deloadWarning = checkDeload(newCTL, newATL, newTSB);

      db.upsertDailyMetric({
        day_key: dayKey,
        daily_tss: dailyTSS,
        ctl: newCTL,
        atl: newATL,
        tsb: newTSB,
        m: newM,
        pr: currentPR,
        weight_mult: currentWeightMult,
        rm1_predicted: new1RMPred,
        deload_warning: deloadWarning,
        plateau_hit: plateauHit,
        anabolism: A,
        catabolism: C,
        total_sets: totalSets
      });

      prevCTL = newCTL;
      prevATL = newATL;
      prevPR = currentPR;
      prevWeightMult = currentWeightMult;
      prev1RMPred = new1RMPred;

      trainingDayIndex++;
      console.log(`Training ${formatDate(currentDate)}: ${totalSets} sets, TSS=${dailyTSS.toFixed(1)}, CTL=${prevCTL.toFixed(1)}, ATL=${prevATL.toFixed(1)}, TSB=${(prevCTL - prevATL).toFixed(1)}, M=${newM.toFixed(4)}, PR=${currentPR.toFixed(1)}, 1RM_pred=${new1RMPred.toFixed(1)}${plateauHit ? ' PLATEAU!' : ''}${deloadWarning ? ' DELOAD!' : ''}`);
    } else {
      C = computeCatabolism(prevM, 0, params);
      newM = updateM(prevM, C, 0, params);

      const newCTL = computeCTL(prevCTL, 0, params);
      const newATL = computeATL(prevATL, 0, params);
      const newTSB = computeTSB(newCTL, newATL);

      db.upsertDailyMetric({
        day_key: dayKey,
        daily_tss: 0,
        ctl: newCTL,
        atl: newATL,
        tsb: newTSB,
        m: newM,
        pr: prevPR,
        weight_mult: prevWeightMult,
        rm1_predicted: compute1RM(prevPR, newM, prevWeightMult),
        deload_warning: 0,
        plateau_hit: 0,
        anabolism: 0,
        catabolism: C,
        total_sets: 0
      });

      prevCTL = newCTL;
      prevATL = newATL;
      prevM = newM;

      restDayIndex++;
    }

    mHistory.push(newM);
    prevM = newM;
  }

  console.log(`\nAnalysis complete. Processed ${trainingDayIndex} training days + ${restDayIndex} rest days = ${totalCalendarDays} calendar days.`);
}

module.exports = { runAnalysis };
