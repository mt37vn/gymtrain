const db = require('../database');
const { computeEpley1RM } = require('./muscle-dynamics');
const { computeSetTSS, computeSMA } = require('./neural-fatigue');
const { getParams } = require('../params');
const { analyzeExercise } = require('./exercise-analyzer');

function simulateProgram(programId, weeksOverride) {
  const program = db.getProgram(programId);
  if (!program) return null;

  const params = getParams();
  const RIR = params.rir_threshold || 0.3;
  const G_SET = params.growth_per_set || 0.001;
  const G_MAX = params.max_growth_per_day || 0.003;
  const DECAY = params.decay_per_day || 0.001;
  const FLOOR = params.peak_floor_ratio || 0.7;
  const PROTECT = params.decay_protection_days || 7;
  const FITNESS_WIN = params.fitness_window_days || 42;
  const FATIGUE_WIN = params.fatigue_window_days || 7;
  const OVERTRAIN = params.overtrain_threshold || -20;

  const totalWeeks = weeksOverride || program.weeks;
  const uniqueDays = program.days.length;
  const daysPerWeek = program.days_per_week || uniqueDays;
  const trainingDayCount = totalWeeks * daysPerWeek;

  const exState = {};
  const allTSS = [];
  const tsbPerDay = [];
  const result = { weeks: [] };

  // Seed allTSS with historical daily TSS so initial CTL/ATL reflects current fitness
  const recent = db.getRecentDailyMetrics(FITNESS_WIN);
  for (const r of recent) {
    allTSS.push(r.daily_tss || 0);
    tsbPerDay.push(r.tsb || 0);
  }

  let deloadActive = false;

  for (let di = 0; di < trainingDayCount; di++) {
    const n = uniqueDays;
    const d = daysPerWeek;
    const p = di % d;
    const w = Math.floor(di / d);
    const startOffset = d > n ? (w % n) : 0;
    const dayIdx = (startOffset + p) % n;
    const weekIdx = Math.floor(di / d);
    const day = program.days[dayIdx];
    if (!day) continue;

    const isDeload = deloadActive;
    const exercises = [];
    let dailyTSS = 0;

    for (const ex of day.exercises) {
      let state = exState[ex.exercise_name];
      if (!state) {
        const timeline = analyzeExercise(ex.exercise_name);
        const last = timeline.length > 0 ? timeline[timeline.length - 1] : null;
        const predictedPR = last ? (last.rm1_predicted || 0) : 0;
        const peakPR = timeline.reduce((max, d) => d.catabolism > max ? d.catabolism : max, 0);
        const suggestedWeight = predictedPR > 0
          ? Math.round(predictedPR * 30 / (30 + ex.min_reps + ex.rir) / ex.min_increment) * ex.min_increment
          : 0;
        state = {
          predictedPR,
          peakPR: peakPR || predictedPR,
          startWeight: suggestedWeight,
          currentWeight: suggestedWeight,
          currentReps: ex.min_reps,
          effectiveHistory: [0, 0, 0, 0],
          lastEffectiveDay: -999
        };
        exState[ex.exercise_name] = state;
      }

      if (state.predictedPR <= 0) continue;

      const useWeight = isDeload ? state.currentWeight * 0.5 : state.currentWeight;
      const useReps = isDeload ? Math.max(1, Math.floor(state.currentReps * 0.5)) : state.currentReps;

      let setTSS = 0;
      let effCount = 0;
      const maxAbilityReps = Math.floor(30 * (state.predictedPR / useWeight - 1));

      for (let si = 0; si < ex.sets; si++) {
        if (useReps <= 0 || useWeight <= 0) continue;
        setTSS += computeSetTSS(useWeight, useReps, state.predictedPR);

        if (!isDeload) {
          const rir = maxAbilityReps - useReps;
          if (rir <= Math.max(1, Math.round(useReps * RIR))) effCount++;
        }
      }

      dailyTSS += setTSS;
      state.effectiveHistory.unshift(effCount);
      state.effectiveHistory.length = 4;
      if (effCount > 0) state.lastEffectiveDay = di;

      const sumPast = state.effectiveHistory[1] + state.effectiveHistory[2] + state.effectiveHistory[3];
      const growthRate = Math.min(G_MAX, sumPast * G_SET);
      const daysSinceEffective = di - state.lastEffectiveDay;
      const netRate = daysSinceEffective <= PROTECT ? growthRate : growthRate - DECAY;
      const floorPR = state.peakPR * FLOOR;

      state.predictedPR = Math.max(floorPR, state.predictedPR * (1 + netRate));
      if (state.predictedPR > state.peakPR) state.peakPR = state.predictedPR;

      exercises.push({
        name: ex.exercise_name,
        weight: Math.round(useWeight * 10) / 10,
        reps: useReps,
        sets: ex.sets,
        predicted_1rm: Math.round(state.predictedPR * 10) / 10,
        effective_sets: effCount,
        min_reps: ex.min_reps,
        max_reps: ex.max_reps,
        min_increment: ex.min_increment,
        rir: ex.rir
      });

      if (!isDeload && effCount > 0) {
        if (state.currentReps < ex.max_reps) {
          state.currentReps++;
        } else {
          state.currentWeight = Math.round((state.currentWeight + ex.min_increment) * 10) / 10;
          state.currentReps = ex.min_reps;
        }
      }
    }

    allTSS.push(dailyTSS);

    const ctl = computeSMA(allTSS, FITNESS_WIN);
    const atl = computeSMA(allTSS, FATIGUE_WIN);
    const tsb = ctl - atl;
    tsbPerDay.push(tsb);

    // Instant deload toggle based on TSB% of CTL (consistent with frontend trainingStatus)
    const tsbPct = ctl > 0 ? (tsb / ctl) * 100 : 0;
    deloadActive = tsbPct < OVERTRAIN;

    if (!result.weeks[weekIdx]) result.weeks[weekIdx] = { week: weekIdx + 1, days: [] };

    result.weeks[weekIdx].days.push({
      day: dayIdx + 1,
      day_name: day.name || `Day ${dayIdx + 1}`,
      tss: Math.round(dailyTSS * 10) / 10,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      is_deload: isDeload,
      _da: deloadActive,
      exercises
    });
  }

  result.exercise_summary = {};
  for (const [name, state] of Object.entries(exState)) {
    if (state.predictedPR <= 0) continue;
    result.exercise_summary[name] = {
      start_weight: Math.round(state.startWeight * 10) / 10,
      end_weight: Math.round(state.currentWeight * 10) / 10
    };
  }

  return result;
}

function suggestWeight(exercise, minReps, rir) {
  const timeline = analyzeExercise(exercise);
  const last = timeline.length > 0 ? timeline[timeline.length - 1] : null;
  const predictedPR = last ? (last.rm1_predicted || 0) : 0;
  if (predictedPR <= 0) return { weight: 0, predicted_1rm: 0 };
  const weight = predictedPR * 30 / (30 + minReps + rir);
  return { weight: Math.round(weight * 10) / 10, predicted_1rm: Math.round(predictedPR * 10) / 10 };
}

module.exports = { simulateProgram, suggestWeight };
