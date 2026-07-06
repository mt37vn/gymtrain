const express = require('express');
const db = require('../database');
const { analyzeExercise } = require('../engine/exercise-analyzer');
const { parseCSVContent } = require('../csv-parser');
const { runAnalysis } = require('../engine/analyzer');
const { getParams, saveParams, resetParams } = require('../params');

const router = express.Router();

function applyDayRange(metrics, days, from, to) {
  if (from && to) {
    return metrics.filter(m => m.day_key >= from && m.day_key <= to);
  }
  if (!days) return metrics;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - parseInt(days, 10));
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  return metrics.filter(m => m.day_key >= cutoffKey);
}

router.get('/summary', (req, res) => {
  const exercise = req.query.exercise;
  const days = req.query.days;
  const from = req.query.from;
  const to = req.query.to;

  if (exercise) {
    const timeline = analyzeExercise(exercise);
    const filtered = applyDayRange(timeline, days, from, to);
    if (filtered.length === 0) return res.json({ error: 'No data for this exercise' });
    return res.json(filtered[filtered.length - 1]);
  }

  let latest = db.getLatestMetric();
  if (!latest) return res.json({ error: 'No data' });

  if (days || (from && to)) {
    const metrics = db.getAllDailyMetrics();
    const filtered = applyDayRange(metrics, days, from, to);
    if (filtered.length > 0) {
      latest = filtered[filtered.length - 1];
    }
  }
  res.json(latest);
});

router.get('/timeline', (req, res) => {
  const exercise = req.query.exercise;
  const days = req.query.days;
  const from = req.query.from;
  const to = req.query.to;

  let metrics;
  if (exercise) {
    metrics = analyzeExercise(exercise);
  } else {
    metrics = db.getAllDailyMetrics();
  }

  metrics = applyDayRange(metrics, days, from, to);
  res.json(metrics);
});

router.get('/exercises', (req, res) => {
  const rows = db.getDistinctExercises();
  res.json(rows.map(r => r.exercise));
});

router.get('/plateaus', (req, res) => {
  const events = db.getAllPlateauEvents();
  res.json(events);
});

router.get('/stats', (req, res) => {
  const stats = db.getAggregateStats();
  res.json(stats);
});

router.get('/tss-breakdown', (req, res) => {
  const from = req.query.from;
  const to = req.query.to;
  if (!from || !to) return res.json([]);
  const rows = db.getTSSBreakdown(from, to);
  res.json(rows);
});

router.get('/last-reps', (req, res) => {
  const exercise = req.query.exercise;
  if (!exercise) return res.json(null);
  res.json(db.getLastSetReps(exercise));
});

router.get('/sets', (req, res) => {
  const { exercise, date } = req.query;
  if (!exercise || !date) return res.json([]);
  res.json(db.getSetsByDayAndExercise(date, exercise));
});

router.post('/import-csv', express.text({ type: 'text/csv', limit: '1mb' }), (req, res) => {
  try {
    const { sets, skipped } = parseCSVContent(req.body);
    if (sets.length > 10000) return res.status(413).json({ error: 'CSV too large: max 10,000 rows.' });
    let imported = 0;
    let duplicates = 0;
    const insert = db.getDb().transaction((rows) => {
      const stmt = db.getDb().prepare(`
        INSERT INTO workout_sets (workout, start_ms, end_ms, exercise, weight, bodyweight, reps, is_warmup, is_max, is_fail, day_key)
        VALUES (@workout, @start_ms, @end_ms, @exercise, @weight, @bodyweight, @reps, @is_warmup, @is_max, @is_fail, @day_key)
      `);
      for (const row of rows) {
        if (db.setExists(row.start_ms, row.exercise, row.reps, row.weight)) {
          duplicates++;
          continue;
        }
        stmt.run(row);
        imported++;
      }
    });
    insert(sets);

    res.json({ imported, duplicates, skipped, total: sets.length });

    if (imported > 0) {
      setImmediate(runAnalysis);
    }
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

function computeStats(values) {
  const n = values.length;
  if (n < 3) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const variance = sorted.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const median = n % 2 === 1 ? sorted[Math.floor(n / 2)] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { mean, std, median, n };
}

function detectAnomalies(exercise, sets) {
  const repsVals = sets.map(s => s.reps).filter(r => r > 0);
  const weightsVals = sets.map(s => s.weight).filter(w => w > 0);

  const rStats = computeStats(repsVals);
  const wStats = computeStats(weightsVals);

  const isDumbbell = /dumbbell/i.test(exercise);
  const repMedian = rStats ? rStats.median : 0;
  const weightMedian = wStats ? wStats.median : 0;

  const flagged = [];
  for (const s of sets) {
    const reasons = [];

    // Reps looks like extra digit (e.g. 155 instead of 15)
    if (repMedian > 0 && s.reps >= 30 && s.reps > repMedian * 4)
      reasons.push(`Likely extra digit: reps ${s.reps} vs typical ${repMedian.toFixed(0)}`);

    // Dumbbell weight possibly doubled (total instead of per-hand)
    if (isDumbbell && weightMedian > 0 && s.weight > weightMedian * 1.6 && s.weight < weightMedian * 2.3)
      reasons.push(`Likely doubled weight: ${s.weight}kg ≈ ${(s.weight/weightMedian).toFixed(1)}× typical (${weightMedian.toFixed(1)}kg)`);

    if (reasons.length > 0) {
      const rm1Val = s.weight > 0 && s.reps > 0 ? s.weight * (1 + s.reps / 30) : 0;
      flagged.push({ id: s.id, day_key: s.day_key, exercise: s.exercise, weight: s.weight, reps: s.reps, epley_1rm: +rm1Val.toFixed(1), reasons });
    }
  }
  return flagged;
}

router.get('/anomalies', (req, res) => {
  const all = db.getWorkingSets();
  const grouped = {};
  for (const s of all) {
    if (!grouped[s.exercise]) grouped[s.exercise] = [];
    grouped[s.exercise].push(s);
  }
  const result = [];
  for (const [exercise, sets] of Object.entries(grouped)) {
    result.push(...detectAnomalies(exercise, sets));
  }
  res.json(result);
});

router.put('/sets/:id', express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  const fields = {};
  if (req.body.weight !== undefined) fields.weight = req.body.weight;
  if (req.body.reps !== undefined) fields.reps = req.body.reps;
  if (req.body.bodyweight !== undefined) fields.bodyweight = req.body.bodyweight;
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: 'No fields to update' });
  db.updateSet(id, fields);
  runAnalysis();
  res.json({ ok: true });
});

router.delete('/sets/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  db.deleteSet(id);
  runAnalysis();
  res.json({ ok: true });
});

function computeWeightRIR3(pre, reps) {
  return Math.ceil(pre * 30 / (34 + reps) * 10) / 10;
}
function computeWeightRIR0(pre, reps) {
  return Math.floor(pre * 30 / (30 + reps) * 10) / 10;
}

router.get('/exercise-status', (req, res) => {
  const exercises = db.getDistinctExercises();
  const params = getParams();
  const floorRatio = params.peak_floor_ratio || 0.7;
  const reps = parseInt(req.query.reps, 10) || 8;
  const result = [];

  for (const { exercise } of exercises) {
    try {
      const timeline = analyzeExercise(exercise);
      if (timeline.length === 0) continue;

      const peakPR = timeline.reduce((max, d) => d.catabolism > max ? d.catabolism : max, 0);
      const floorPR = peakPR * floorRatio;
      const trainingDays = timeline.filter(d => d.total_sets > 0 && d.pr_actual > 0);
      const lastTraining = trainingDays.length > 0 ? trainingDays[trainingDays.length - 1] : null;
      const lastPR = lastTraining ? lastTraining.pr_actual : 0;
      const last = timeline[timeline.length - 1];
      const predictedPR = last ? (last.rm1_predicted || 0) : 0;

      const lastKg = lastPR > 0 ? +(lastPR * 30 / (30 + reps)).toFixed(1) : 0;
      const recLow = lastPR > 0 && predictedPR > 0 ? computeWeightRIR3(predictedPR, reps) : 0;
      const recHigh = lastPR > 0 && predictedPR > 0 ? computeWeightRIR0(predictedPR, reps) : 0;

      let status = 'no_data';
      if (lastPR > 0) {
        if (lastPR < floorPR) status = 'below_floor';
        else if (predictedPR > 0 && lastPR < predictedPR * 0.95) status = 'below_rec';
        else if (predictedPR > 0 && lastPR > predictedPR * 1.05) status = 'above_rec';
        else status = 'in_rec';
      }

      result.push({
          exercise: lastTraining.exercise || exercise,
          last_day: lastTraining.day_key,
          last_pr: +lastPR.toFixed(1),
          peak_pr: +peakPR.toFixed(1),
          floor_pr: +floorPR.toFixed(1),
          predicted_pr: +predictedPR.toFixed(1),
          last_pr_kg: lastKg,
          rec_low_kg: recLow,
          rec_high_kg: recHigh,
          status
        });
    } catch (e) {
      // skip exercises that error
    }
  }

  const order = { below_floor: 0, below_rec: 1, above_rec: 2, in_rec: 3, no_data: 4 };
  result.sort((a, b) => (order[a.status] || 9) - (order[b.status] || 9));
  res.json(result);
});

router.get('/params', (req, res) => {
  res.json(getParams());
});

router.put('/params', express.json(), (req, res) => {
  const saved = saveParams(req.body);
  res.json(saved);
});

router.post('/params/reset', (req, res) => {
  const defaults = resetParams();
  res.json(defaults);
});

module.exports = router;
