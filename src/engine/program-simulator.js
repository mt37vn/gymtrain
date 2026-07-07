const db = require('../database');
const { computeEpley1RM, computeWeightAtRIR } = require('./muscle-dynamics');
const { computeSetTSS, computeSMA, checkDeload, getExerciseMultiplier, trainingStatus } = require('./neural-fatigue');
const { nearestPlateWeight, BAR_KG } = require('./plate-calc');
const { getParams } = require('../params');
const { analyzeExercise } = require('./exercise-analyzer');

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function trainingDayOffsets(daysPerWeek) {
  const MAP = {
    0: [], 1: [0], 2: [0, 4], 3: [0, 2, 5], 4: [0, 2, 4, 6],
    5: [0, 1, 3, 4, 6], 6: [0, 1, 2, 3, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6]
  };
  return MAP[daysPerWeek] || [];
}

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
  const daysPerWeek = program.days_per_week || uniqueDays || 1;
  const d = daysPerWeek;
  const n = uniqueDays;
  const offsets = trainingDayOffsets(d);
  const totalCalendarDays = totalWeeks * 7;

  const exState = {};
  const allTSS = [];
  const result = { weeks: [] };

  // Seed allTSS with historical daily TSS so initial CTL/ATL reflects current fitness
  const recent = db.getRecentDailyMetrics(FITNESS_WIN);
  for (const r of recent) {
    allTSS.push(r.daily_tss || 0);
  }

  let deloadActive = false;

  for (let cd = 0; cd < totalCalendarDays; cd++) {
    const dow = cd % 7;
    const weekIdx = Math.floor(cd / 7);
    const isTrainingDay = offsets.includes(dow);

    // Shift effectiveHistory for ALL exercises every calendar day (rest days = 0)
    for (const state of Object.values(exState)) {
      state.effectiveHistory.unshift(0);
      state.effectiveHistory.length = 4;
    }

    const isDeload = deloadActive;
    const exercises = [];
    let dailyTSS = 0;
    let dayName = 'Rest';

    if (isTrainingDay) {
      const sessionInWeek = offsets.indexOf(dow);
      const w = weekIdx;
      const p = sessionInWeek;
      const startOffset = d > n ? (w % n) : 0;
      const dayIdx = (startOffset + p) % n;
      const day = program.days[dayIdx];

      if (day) {
        dayName = day.name || DAY_NAMES[dow];
        for (const ex of day.exercises) {
          let state = exState[ex.exercise_name];
          if (!state) {
            const timeline = analyzeExercise(ex.exercise_name);
            const last = timeline.length > 0 ? timeline[timeline.length - 1] : null;
            const predictedPR = last ? (last.rm1_predicted || 0) : 0;
            const peakPR = timeline.reduce((max, d) => d.catabolism > max ? d.catabolism : max, 0);
            const recLow = predictedPR > 0 ? computeWeightAtRIR(predictedPR, ex.min_reps, RIR) : 0;
            const recHigh = predictedPR > 0 ? computeWeightAtRIR(predictedPR, ex.min_reps, 0) : 0;
            const lastSet = db.getLastSetReps(ex.exercise_name);
            const lastWeight = lastSet ? lastSet.weight : 0;
            let startWeight;
            if (lastWeight > 0 && recLow > 0 && recHigh > 0) {
              startWeight = Math.max(recLow, Math.min(recHigh, lastWeight));
            } else if (predictedPR > 0) {
              startWeight = computeWeightAtRIR(predictedPR, ex.min_reps, 0);
            } else {
              startWeight = 0;
            }
            if (startWeight > 0) {
              startWeight = ex.use_lb_inc
                ? nearestPlateWeight(BAR_KG, startWeight).totalKg
                : Math.round(startWeight / ex.min_increment) * ex.min_increment;
            }
            state = {
              predictedPR,
              peakPR: peakPR || predictedPR,
              startWeight,
              currentWeight: startWeight,
              currentReps: ex.min_reps,
              effectiveHistory: [0, 0, 0, 0],
              lastEffectiveDay: -999
            };
            exState[ex.exercise_name] = state;
          }

          if (state.predictedPR <= 0) continue;

          const useWeight = isDeload ? state.currentWeight * 0.5 : state.currentWeight;
          const useReps = state.currentReps;

          let setTSS = 0;
          let effCount = 0;
          const maxAbilityReps = Math.floor(30 * (state.predictedPR / useWeight - 1));

          for (let si = 0; si < ex.sets; si++) {
            if (useReps <= 0 || useWeight <= 0) continue;
            setTSS += computeSetTSS(useWeight, useReps, params.bodyweight || 70);

            if (!isDeload) {
              const rir = maxAbilityReps - useReps;
              if (rir <= Math.max(1, Math.round(useReps * RIR))) effCount++;
            }
          }

          const exTSS = setTSS * getExerciseMultiplier(ex.exercise_name);
          dailyTSS += exTSS;
          state.effectiveHistory[0] = effCount;
          if (effCount > 0) state.lastEffectiveDay = cd;

          const sumPast = state.effectiveHistory[1] + state.effectiveHistory[2] + state.effectiveHistory[3];
          const growthRate = Math.min(G_MAX, sumPast * G_SET);
          const daysSinceEffective = cd - state.lastEffectiveDay;
          const netRate = daysSinceEffective <= PROTECT ? growthRate : growthRate - DECAY;
          const floorPR = state.peakPR * FLOOR;

          state.predictedPR = Math.max(floorPR, state.predictedPR * (1 + netRate));
          if (state.predictedPR > state.peakPR) state.peakPR = state.predictedPR;

          exercises.push({
            name: ex.exercise_name,
            weight: Math.round(useWeight * 10) / 10,
            reps: useReps,
            sets: ex.sets,
            tss: Math.round(exTSS * 10) / 10,
            predicted_1rm: Math.round(state.predictedPR * 10) / 10,
            max_reps: Math.floor(30 * ((useWeight + ex.min_increment) / useWeight * (1 + ex.min_reps / 30) - 1)),
            effective_sets: effCount,
            min_reps: ex.min_reps,
            min_increment: ex.min_increment,
            use_lb_inc: ex.use_lb_inc ? 1 : 0,
            plates: (function() {
              if (!ex.use_lb_inc) return '';
              const p = nearestPlateWeight(BAR_KG, useWeight);
              const sorted = [...p.plates].sort((a, b) => b.kg - a.kg);
              return sorted.map(x => x.count + '×' + x.kg).join(' + ');
            })()
          });

          if (!isDeload && effCount > 0) {
            // Epley: max reps you can do at current weight given predicted 1RM
            // Reps stall here until predictedPR grows enough to raise the ceiling
            const epleyMaxReps = state.currentWeight > 0 && state.predictedPR > 0
              ? Math.floor(30 * (state.predictedPR / state.currentWeight - 1))
              : 0;
            const canAddRep = epleyMaxReps <= 0 || state.currentReps < epleyMaxReps;

            const maxRepsThreshold = state.currentWeight > 0 && ex.min_increment > 0 && ex.min_reps > 0
              ? Math.floor(30 * ((state.currentWeight + ex.min_increment) / state.currentWeight * (1 + ex.min_reps / 30) - 1))
              : 0;

            if (state.currentReps >= maxRepsThreshold && maxRepsThreshold > 0) {
              // Ready for weight progression: check if next weight fits within PR dự kiến
              let nextW = state.currentWeight + ex.min_increment;
              const maxWeightAtReps = computeWeightAtRIR(state.predictedPR, ex.min_reps, 0);
              if (nextW >= maxWeightAtReps && maxWeightAtReps > 0) {
                // Next weight too heavy — try rep progression instead (capped by Epley)
                if (canAddRep) { state.currentReps++; }
              } else {
                state.currentWeight = ex.use_lb_inc
                  ? nearestPlateWeight(BAR_KG, nextW).totalKg
                  : Math.round(nextW / ex.min_increment) * ex.min_increment;
                state.currentReps = ex.min_reps;
              }
            } else {
              // Rep progression (capped by Epley max at current weight)
              if (canAddRep) { state.currentReps++; }
            }
          }
        }
      }
    }

    // Apply growth/decay to ALL known exercises every calendar day
    for (const state of Object.values(exState)) {
      if (state.predictedPR > 0) {
        const sumPast = state.effectiveHistory[1] + state.effectiveHistory[2] + state.effectiveHistory[3];
        const growthRate = Math.min(G_MAX, sumPast * G_SET);
        const daysSinceEffective = cd - state.lastEffectiveDay;
        const netRate = daysSinceEffective <= PROTECT ? growthRate : growthRate - DECAY;
        const floorPR = state.peakPR * FLOOR;
        state.predictedPR = Math.max(floorPR, state.predictedPR * (1 + netRate));
        if (state.predictedPR > state.peakPR) state.peakPR = state.predictedPR;
      }
    }

    allTSS.push(dailyTSS);

    const ctl = computeSMA(allTSS, FITNESS_WIN);
    const atl = computeSMA(allTSS, FATIGUE_WIN);
    const tsb = ctl - atl;
    const status = trainingStatus(tsb, ctl, params.detrain_threshold || 20, OVERTRAIN);

    deloadActive = checkDeload(ctl, atl, OVERTRAIN);

    if (!result.weeks[weekIdx]) result.weeks[weekIdx] = { week: weekIdx + 1, days: [] };

    result.weeks[weekIdx].days.push({
      day: dow + 1,
      day_name: dayName,
      tss: Math.round(dailyTSS * 10) / 10,
      ctl: Math.round(ctl * 10) / 10,
      atl: Math.round(atl * 10) / 10,
      tsb: Math.round(tsb * 10) / 10,
      is_deload: isDeload,
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

function suggestWeight(exercise, minReps, rirPct) {
  const params = getParams();
  const pct = rirPct !== undefined ? rirPct : (params.rir_threshold || 0.3);
  const timeline = analyzeExercise(exercise);
  const last = timeline.length > 0 ? timeline[timeline.length - 1] : null;
  const predictedPR = last ? (last.rm1_predicted || 0) : 0;
  if (predictedPR <= 0) return { weight: 0, predicted_1rm: 0 };
  const calcWeight = computeWeightAtRIR(predictedPR, minReps, pct);
  return { weight: Math.round(calcWeight * 10) / 10, predicted_1rm: Math.round(predictedPR * 10) / 10 };
}

module.exports = { simulateProgram, suggestWeight, trainingDayOffsets };
