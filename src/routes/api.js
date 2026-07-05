const express = require('express');
const db = require('../database');

const router = express.Router();

router.get('/summary', (req, res) => {
  const latest = db.getLatestMetric();
  if (!latest) return res.json({ error: 'No data' });
  res.json(latest);
});

router.get('/timeline', (req, res) => {
  const metrics = db.getAllDailyMetrics();
  res.json(metrics);
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
