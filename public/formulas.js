/* ─── Formulas: mirrors of backend src/engine/ ───
   These must stay in sync with their backend counterparts.
   When changing a formula, update BOTH this file and the backend source.
   ================================================================
   Mirrors src/engine/muscle-dynamics.js
   Mirrors src/engine/neural-fatigue.js
   ================================================================ */

/* mirrors src/engine/neural-fatigue.js */
function trainingStatus(tsb, fitness, detrainTh, overtrainTh) {
  if (fitness <= 0) return { label: 'Detrain', cls: 'detrain', desc: 'No training load detected' };
  const tsbPct = (tsb / fitness) * 100;
  if (tsbPct > (detrainTh || 20)) return { label: 'Detrain', cls: 'detrain', desc: 'Low training load — consider increasing volume' };
  if (tsbPct >= 0) return { label: 'Deload', cls: 'deload', desc: 'Recovery zone — moderate training recommended' };
  if (tsbPct >= (overtrainTh || -20)) return { label: 'Productive', cls: 'productive', desc: 'Optimal load — good adaptation' };
  return { label: 'Overtrain', cls: 'overtrain', desc: 'Excessive load — deload strongly recommended' };
}

/* mirrors src/engine/muscle-dynamics.js */
function computeWeightAtRIR(pre, reps, rirPct) {
  if (pre <= 0 || reps <= 0) return 0;
  const rirReps = Math.round(reps * rirPct);
  return Math.round(pre * 30 / (30 + reps + rirReps) * 10) / 10;
}

/* mirrors src/engine/muscle-dynamics.js — inverse of computeEpley1RM */
function convert1RMToWeight(rm1, reps) {
  if (!rm1 || rm1 <= 0 || !reps || reps < 1) return 0;
  return rm1 * 30 / (30 + reps);
}

/* ─── Frontend-only utilities ─── */

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatNum(v, d) {
  if (d === undefined) d = 1;
  if (v === null || v === undefined) return '—';
  return Number(v).toFixed(d);
}
