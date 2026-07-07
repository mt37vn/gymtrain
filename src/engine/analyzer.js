const { computeSetTSS, computeSMA, checkDeload, getExerciseMultiplier, getEffectiveExerciseWeight } = require('./neural-fatigue');
const { computeEpley1RM } = require('./muscle-dynamics');
const db = require('../database');
const { getParams } = require('../params');

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
  const FITNESS_WINDOW = params.fitness_window_days || 42;
  const FATIGUE_WINDOW = params.fatigue_window_days || 7;
  const RIR = params.rir_threshold || 0.3;
  const G_SET = params.growth_per_set || 0.001;
  const G_MAX = params.max_growth_per_day || 0.003;
  const DECAY = params.decay_per_day || 0.001;
  const FLOOR = params.peak_floor_ratio || 0.7;
  const PROTECT = params.decay_protection_days || 7;
  const OVERTRAIN_TH = params.overtrain_threshold || -20;

  const dayKeys = db.getAllDayKeys();
  if (dayKeys.length === 0) {
    console.log('No data to analyze.');
    return;
  }

  const firstDate = dayKeyToDate(dayKeys[0].day_key);
  const lastDate = new Date();
  const totalCalendarDays = daysBetween(firstDate, lastDate) + 1;

  console.log(`Analysis range: ${formatDate(firstDate)} to ${formatDate(lastDate)} (${totalCalendarDays} calendar days)`);

  const trainingDaySet = new Set(dayKeys.map(d => d.day_key));
  const tssValues = [];
  const exerciseState = {}; // { pre, peak, effectiveHistory: [today, D-1, D-2, D-3], lastEffectiveDay }
  let trainingDayCount = 0;
  let restDayCount = 0;

  for (let i = 0; i < totalCalendarDays; i++) {
    const currentDate = new Date(firstDate);
    currentDate.setDate(firstDate.getDate() + i);
    const dayKey = formatDate(currentDate);
    const isTrainingDay = trainingDaySet.has(dayKey);

    let dailyTSS = 0;
    let totalSets = 0;

    // Shift effectiveHistory for ALL exercises (drop oldest, add 0 for today)
    for (const state of Object.values(exerciseState)) {
      state.effectiveHistory.unshift(0);
      state.effectiveHistory.length = 4;
    }

    if (isTrainingDay) {
      const allSets = db.getSetsByDay(dayKey);
      totalSets = allSets.length;

      const setsByExercise = {};
      for (const s of allSets) {
        if (!setsByExercise[s.exercise]) setsByExercise[s.exercise] = [];
        setsByExercise[s.exercise].push(s);
      }

      for (const [exName, sets] of Object.entries(setsByExercise)) {
        let state = exerciseState[exName];
        if (!state) {
          state = { pre: 0, peak: 0, effectiveHistory: [0, 0, 0, 0], lastEffectiveDay: -999 };
          exerciseState[exName] = state;
        }

        let exTSS = 0;
        const paramBw = params.bodyweight || 70;
        for (const s of sets) {
          const bw = s.bodyweight || paramBw;
          const effW = getEffectiveExerciseWeight(s.exercise, s.weight, bw);
          const tss = computeSetTSS(effW, s.reps, bw) * getExerciseMultiplier(s.exercise);
          dailyTSS += tss;
          exTSS += tss;
        }

        // Count effective sets (RIR ≤ R)
        let effCount = 0;
        if (state.pre > 0) {
          for (const s of sets) {
            const bw = s.bodyweight || paramBw;
            const effW = getEffectiveExerciseWeight(s.exercise, s.weight, bw);
            if (effW <= 0 || s.reps <= 0) continue;
            const maxReps = Math.floor(30 * (state.pre / effW - 1));
            if (maxReps < 1) { effCount++; continue; }
            const rir = maxReps - s.reps;
            if (rir <= Math.max(1, Math.round(s.reps * RIR))) effCount++;
          }
        }
        state.effectiveHistory[0] = effCount;
        if (effCount > 0) state.lastEffectiveDay = i;

        // Compute actual Epley
        const todayEpley = sets.reduce((max, s) => {
          const bw = s.bodyweight || paramBw;
          const ep = computeEpley1RM(getEffectiveExerciseWeight(s.exercise, s.weight, bw), s.reps);
          return ep > max ? ep : max;
        }, 0);
        if (state.pre === 0 || todayEpley > state.pre) state.pre = todayEpley;
        if (state.pre > state.peak) state.peak = state.pre;

        db.upsertTSSBreakdown(dayKey, exName, exTSS, sets.length);
      }
    }

    // Apply growth/decay to ALL known exercises
    for (const state of Object.values(exerciseState)) {
      if (state.pre > 0) {
        const h = state.effectiveHistory;
        const sumPast = h[1] + h[2] + h[3];
        const growthRate = Math.min(G_MAX, sumPast * G_SET);
        const daysSinceEffective = i - state.lastEffectiveDay;
        const netRate = daysSinceEffective <= PROTECT ? growthRate : growthRate - DECAY;
        const floorPR = state.peak * FLOOR;
        state.pre = Math.max(floorPR, state.pre * (1 + netRate));
      }
    }

    tssValues.push(dailyTSS);
    const fitness = computeSMA(tssValues, FITNESS_WINDOW);
    const fatigue = computeSMA(tssValues, FATIGUE_WINDOW);
    const tsb = fitness - fatigue;
    const deloadWarning = checkDeload(fitness, fatigue, OVERTRAIN_TH);

    db.upsertDailyMetric({
      day_key: dayKey,
      daily_tss: dailyTSS,
      ctl: fitness,
      atl: fatigue,
      tsb: tsb,
      m: 1.0,
      pr: 0,
      weight_mult: 1.0,
      rm1_predicted: 0,
      deload_warning: deloadWarning,
      plateau_hit: 0,
      anabolism: 0,
      catabolism: 0,
      total_sets: totalSets
    });

    if (isTrainingDay) {
      trainingDayCount++;
      console.log(`Training ${formatDate(currentDate)}: ${totalSets} sets, Vol=${dailyTSS.toFixed(0)}, Fitness=${fitness.toFixed(1)}, Fatigue=${fatigue.toFixed(1)}, TSB=${tsb.toFixed(1)}${deloadWarning ? ' DELOAD!' : ''}`);
    } else {
      restDayCount++;
    }
  }

  console.log(`\nAnalysis complete. Processed ${trainingDayCount} training days + ${restDayCount} rest days = ${totalCalendarDays} calendar days.`);
}

module.exports = { runAnalysis };
