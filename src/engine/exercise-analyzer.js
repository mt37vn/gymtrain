const db = require('../database');
const { computeEpley1RM } = require('./muscle-dynamics');
const { getParams } = require('../params');

function countEffectiveSets(sets, pre, rirThreshold) {
  if (pre <= 0) return 0;
  let count = 0;
  for (const s of sets) {
    if (s.weight <= 0 || s.reps <= 0) continue;
    const maxReps = Math.floor(30 * (pre / s.weight - 1));
    if (maxReps < 1) { count++; continue; }
    const rir = maxReps - s.reps;
    if (rir <= Math.max(1, Math.round(s.reps * rirThreshold))) count++;
  }
  return count;
}

function analyzeExercise(exercise) {
  const params = getParams();
  const RIR = params.rir_threshold || 0.3;
  const WIN = params.effective_window_days || 3;
  const G_SET = params.growth_per_set || 0.001;
  const G_MAX = params.max_growth_per_day || 0.003;
  const DECAY = params.decay_per_day || 0.001;
  const FLOOR = params.peak_floor_ratio || 0.7;
  const PROTECT = params.decay_protection_days || 7;

  const dayKeys = db.getAllDayKeysForExercise(exercise);
  if (dayKeys.length === 0) return [];

  const firstRow = db.getDb().prepare('SELECT MIN(day_key) as first FROM workout_sets WHERE exercise = ?').get(exercise);
  if (!firstRow || !firstRow.first) return [];
  const firstDate = new Date(firstRow.first + 'T00:00:00Z');
  const lastDate = new Date();
  const totalDays = Math.round((lastDate - firstDate) / (1000 * 60 * 60 * 24)) + 1;

  const trainingDaySet = new Set(dayKeys.map(d => d.day_key));
  const results = [];

  let prevPRe = 0;
  let peakPR = 0;
  let lastEffectiveDay = -999;
  const effectiveHistory = new Array(WIN + 1).fill(0);

  for (let i = 0; i < totalDays; i++) {
    const currentDate = new Date(firstDate);
    currentDate.setDate(firstDate.getDate() + i);
    const dayKey = currentDate.toISOString().slice(0, 10);
    const isTrainingDay = trainingDaySet.has(dayKey);

    effectiveHistory.unshift(0);
    effectiveHistory.length = WIN + 1;

    let sets = [];
    let totalSets = 0;
    let effectiveSetsToday = 0;
    let prActual = 0;
    let newPRe = prevPRe;

    if (isTrainingDay) {
      sets = db.getSetsByDayAndExercise(dayKey, exercise);
      totalSets = sets.length;

      effectiveSetsToday = countEffectiveSets(sets, prevPRe, RIR);
      effectiveHistory[0] = effectiveSetsToday;
      if (effectiveSetsToday > 0) lastEffectiveDay = i;

      prActual = sets.reduce((max, s) => { if (s.is_warmup) return max;
        const ep = computeEpley1RM(s.weight, s.reps);
        return ep > max ? ep : max;
      }, 0);
    }

    const sumPast = effectiveHistory.slice(1, WIN + 1).reduce((a, b) => a + b, 0);
    const growthRate = Math.min(G_MAX, sumPast * G_SET);
    const daysSinceEffective = i - lastEffectiveDay;
    const netRate = daysSinceEffective <= PROTECT ? growthRate : growthRate - DECAY;

    if (prevPRe > 0) {
      const floorPR = peakPR * FLOOR;
      newPRe = Math.max(floorPR, prevPRe * (1 + netRate));
    }

    if (prActual > 0 && (prevPRe === 0 || prActual > newPRe)) {
      newPRe = prActual;
    }

    if (newPRe > peakPR) peakPR = newPRe;

    if (prevPRe === 0 && prActual > 0) {
      newPRe = prActual;
      peakPR = prActual;
    }

    results.push({
      day_key: dayKey,
      daily_tss: 0,
      ctl: 0,
      atl: 0,
      tsb: 0,
      m: 1.0,
      pr: newPRe,
      pr_actual: isTrainingDay ? prActual : null,
      weight_mult: 1.0,
      rm1_predicted: newPRe,
      plateau_hit: 0,
      anabolism: effectiveSetsToday,
      catabolism: peakPR,
      total_sets: totalSets,
      daily_change_pct: (prevPRe > 0) ? netRate * 100 : 0,
      growth_type: (prActual > prevPRe && prevPRe > 0) ? 'correction' : (growthRate > 0 ? 'growth' : 'decay'),
      growth_pct: growthRate * 100,
      decay_pct: (daysSinceEffective <= PROTECT) ? 0 : DECAY * 100,
      net_pct: netRate * 100,
      effective_sets: effectiveSetsToday
    });

    prevPRe = newPRe;
  }

  return results;
}

module.exports = { analyzeExercise };
