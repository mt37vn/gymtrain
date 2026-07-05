const express = require('express');
const db = require('../database');
const { analyzeExercise } = require('../engine/exercise-analyzer');

const router = express.Router();

function applyDayRange(metrics, days) {
  if (!days) return metrics;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - parseInt(days, 10));
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  return metrics.filter(m => m.day_key >= cutoffKey);
}

router.get('/summary', (req, res) => {
  const exercise = req.query.exercise;
  const days = req.query.days;

  if (exercise) {
    const timeline = analyzeExercise(exercise);
    const filtered = days ? applyDayRange(timeline, days) : timeline;
    if (filtered.length === 0) return res.json({ error: 'No data for this exercise' });
    return res.json(filtered[filtered.length - 1]);
  }

  let latest = db.getLatestMetric();
  if (!latest) return res.json({ error: 'No data' });

  if (days) {
    const metrics = db.getAllDailyMetrics();
    const filtered = applyDayRange(metrics, days);
    if (filtered.length > 0) {
      latest = filtered[filtered.length - 1];
    }
  }
  res.json(latest);
});

router.get('/timeline', (req, res) => {
  const exercise = req.query.exercise;
  const days = req.query.days;

  let metrics;
  if (exercise) {
    metrics = analyzeExercise(exercise);
  } else {
    metrics = db.getAllDailyMetrics();
  }

  if (days) {
    metrics = applyDayRange(metrics, days);
  }
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

module.exports = router;
