const ISO_KEYWORDS = ['calf','leg extension','leg curl','lateral raise','front raise','fly','cable cross','tricep','bicep curl','curl','extension','raise','kickback','pullover','isolated','pec deck','reverse fly','face pull'];
const LOW_KEYWORDS = ['forearm', 'wrist', 'grip', 'calf'];
const HALF_BW_EXERCISES = /bench dip|crunch(?:es)?|hanging (leg|knee).*raise|leg raise|lying leg raise|oblique crunch|windshield wiper|sit-?up|back extension/i;

function getExerciseMultiplier(name) {
  const n = (name || '').toLowerCase();
  let base = 1;
  if (LOW_KEYWORDS.some(kw => n.includes(kw))) base = 0.25;
  else if (ISO_KEYWORDS.some(kw => n.includes(kw))) base = 0.5;
  if (n.includes('smith')) { /* no reduction — free-weight-like */ }
  else if (n.includes('leg press')) base *= 0.5;
  else if (n.includes('machine') || n.includes('lever')) base *= 0.8;
  return base;
}

function getEffectiveExerciseWeight(exercise, recordedWeight, bodyweight) {
  if (!exercise || recordedWeight <= 0 || !bodyweight || bodyweight <= 0) return recordedWeight;
  let w = recordedWeight;
  if (/dumbbell/i.test(exercise)) w *= 2;
  const isAtBodyweight = Math.abs(w - bodyweight) / bodyweight < 0.05;
  if (isAtBodyweight && HALF_BW_EXERCISES.test(exercise.toLowerCase())) {
    w *= 0.5;
  }
  return w;
}

function computeSetTSS(weight, reps, bodyweight) {
  if (bodyweight <= 0 || weight <= 0 || reps <= 0) return 0;
  const rm1 = weight * (1 + reps / 30);
  return (rm1 * rm1) / bodyweight;
}

function computeDailyTSS(sets, bodyweight) {
  if (!sets || sets.length === 0) return 0;
  let total = 0;
  for (const set of sets) {
    total += computeSetTSS(set.weight, set.reps, bodyweight);
  }
  return total;
}

function computeSMA(values, window) {
  if (!values || values.length === 0) return 0;
  const count = Math.min(values.length, window);
  const slice = values.slice(values.length - count);
  return slice.reduce((a, b) => a + b, 0) / count;
}

function checkDeload(fitness, fatigue, thresholdPct) {
  if (fitness <= 0) return 0;
  const tsb = fitness - fatigue;
  const th = (thresholdPct || -20) / 100;
  if (tsb < th * fitness) return 1;
  return 0;
}

function trainingStatus(tsb, fitness, detrainTh, overtrainTh) {
  if (fitness <= 0) return { label: 'Detrain', cls: 'detrain', desc: 'No training load detected' };
  const pct = (tsb / fitness) * 100;
  if (pct > (detrainTh || 20)) return { label: 'Detrain', cls: 'detrain', desc: 'Low training load — consider increasing volume' };
  if (pct >= 0) return { label: 'Deload', cls: 'deload', desc: 'Recovery zone — moderate training recommended' };
  if (pct >= (overtrainTh || -20)) return { label: 'Productive', cls: 'productive', desc: 'Optimal load — good adaptation' };
  return { label: 'Overtrain', cls: 'overtrain', desc: 'Excessive load — deload strongly recommended' };
}

module.exports = {
  computeSetTSS,
  computeDailyTSS,
  computeSMA,
  checkDeload,
  trainingStatus,
  getExerciseMultiplier,
  getEffectiveExerciseWeight
};
