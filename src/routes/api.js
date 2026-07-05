const express = require('express');
const db = require('../database');
const { analyzeExercise } = require('../engine/exercise-analyzer');
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
