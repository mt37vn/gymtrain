const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'gym.db');

let db;

function initDatabase() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS workout_sets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      workout     TEXT,
      start_ms    INTEGER NOT NULL,
      end_ms      INTEGER,
      exercise    TEXT,
      weight      REAL,
      bodyweight  REAL,
      reps        INTEGER NOT NULL,
      is_warmup   INTEGER DEFAULT 0,
      is_max      INTEGER DEFAULT 0,
      is_fail     INTEGER DEFAULT 0,
      day_key     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sets_day ON workout_sets(day_key);

    CREATE TABLE IF NOT EXISTS daily_metrics (
      day_key         TEXT PRIMARY KEY,
      daily_tss       REAL DEFAULT 0,
      ctl             REAL DEFAULT 0,
      atl             REAL DEFAULT 0,
      tsb             REAL DEFAULT 0,
      m               REAL DEFAULT 1.0,
      pr              REAL DEFAULT 0,
      weight_mult     REAL DEFAULT 1.0,
      rm1_predicted   REAL DEFAULT 0,
      deload_warning  INTEGER DEFAULT 0,
      plateau_hit     INTEGER DEFAULT 0,
      anabolism       REAL DEFAULT 0,
      catabolism      REAL DEFAULT 0,
      total_sets      INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS plateau_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      day_key     TEXT,
      old_mult    REAL,
      new_mult    REAL
    );

    CREATE TABLE IF NOT EXISTS tss_breakdown (
      day_key     TEXT NOT NULL,
      exercise    TEXT NOT NULL,
      tss         REAL DEFAULT 0,
      sets        INTEGER DEFAULT 0,
      PRIMARY KEY (day_key, exercise)
    );
  `);

  return db;
}

function insertSet(set) {
  const stmt = db.prepare(`
    INSERT INTO workout_sets (workout, start_ms, end_ms, exercise, weight, bodyweight, reps, is_warmup, is_max, is_fail, day_key)
    VALUES (@workout, @start_ms, @end_ms, @exercise, @weight, @bodyweight, @reps, @is_warmup, @is_max, @is_fail, @day_key)
  `);
  return stmt.run(set);
}

function insertSets(sets) {
  const insert = db.transaction((rows) => {
    const stmt = db.prepare(`
      INSERT INTO workout_sets (workout, start_ms, end_ms, exercise, weight, bodyweight, reps, is_warmup, is_max, is_fail, day_key)
      VALUES (@workout, @start_ms, @end_ms, @exercise, @weight, @bodyweight, @reps, @is_warmup, @is_max, @is_fail, @day_key)
    `);
    for (const row of rows) {
      stmt.run(row);
    }
  });
  insert(sets);
}

function upsertDailyMetric(metric) {
  const stmt = db.prepare(`
    INSERT INTO daily_metrics (day_key, daily_tss, ctl, atl, tsb, m, pr, weight_mult, rm1_predicted, deload_warning, plateau_hit, anabolism, catabolism, total_sets)
    VALUES (@day_key, @daily_tss, @ctl, @atl, @tsb, @m, @pr, @weight_mult, @rm1_predicted, @deload_warning, @plateau_hit, @anabolism, @catabolism, @total_sets)
    ON CONFLICT(day_key) DO UPDATE SET
      daily_tss = @daily_tss,
      ctl = @ctl,
      atl = @atl,
      tsb = @tsb,
      m = @m,
      pr = @pr,
      weight_mult = @weight_mult,
      rm1_predicted = @rm1_predicted,
      deload_warning = @deload_warning,
      plateau_hit = @plateau_hit,
      anabolism = @anabolism,
      catabolism = @catabolism,
      total_sets = @total_sets
  `);
  stmt.run(metric);
}

function insertPlateauEvent(event) {
  const stmt = db.prepare(`
    INSERT INTO plateau_events (day_key, old_mult, new_mult)
    VALUES (@day_key, @old_mult, @new_mult)
  `);
  stmt.run(event);
}

function getSetsByDay(dayKey) {
  return db.prepare('SELECT * FROM workout_sets WHERE day_key = ? ORDER BY id').all(dayKey);
}

function getSetsByDayAndExercise(dayKey, exercise) {
  return db.prepare('SELECT * FROM workout_sets WHERE day_key = ? AND exercise = ? ORDER BY id').all(dayKey, exercise);
}

function getAllDayKeys() {
  return db.prepare('SELECT DISTINCT day_key FROM workout_sets ORDER BY day_key').all();
}

function getAllDayKeysForExercise(exercise) {
  return db.prepare('SELECT DISTINCT day_key FROM workout_sets WHERE exercise = ? ORDER BY day_key').all(exercise);
}

function getDistinctExercises() {
  return db.prepare('SELECT DISTINCT exercise FROM workout_sets ORDER BY exercise').all();
}

function getAllDailyMetrics() {
  return db.prepare('SELECT * FROM daily_metrics ORDER BY day_key').all();
}

function getMetricsByDayRange(fromDate, toDate) {
  return db.prepare('SELECT * FROM daily_metrics WHERE day_key >= ? AND day_key <= ? ORDER BY day_key').all(fromDate, toDate);
}

function getDailyTSSForDay(dayKey) {
  const row = db.prepare('SELECT daily_tss FROM daily_metrics WHERE day_key = ?').get(dayKey);
  return row ? row.daily_tss : 0;
}

function getDailyMetricsForDay(dayKey) {
  const row = db.prepare('SELECT daily_tss, ctl, atl, tsb, anabolism FROM daily_metrics WHERE day_key = ?').get(dayKey);
  return row || { daily_tss: 0, ctl: 0, atl: 0, tsb: 0, anabolism: 0 };
}

function getLatestMetric() {
  return db.prepare('SELECT * FROM daily_metrics ORDER BY day_key DESC LIMIT 1').get();
}

function getAllPlateauEvents() {
  return db.prepare('SELECT * FROM plateau_events ORDER BY id').all();
}

function getAggregateStats() {
  const totalRows = db.prepare('SELECT COUNT(*) as count FROM workout_sets').get();
  const totalDays = db.prepare('SELECT COUNT(*) as count FROM daily_metrics').get();
  const latest = getLatestMetric();
  return { totalSets: totalRows.count, totalDays: totalDays.count, latest };
}

function upsertTSSBreakdown(dayKey, exercise, tss, sets) {
  const stmt = db.prepare(`
    INSERT INTO tss_breakdown (day_key, exercise, tss, sets)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(day_key, exercise) DO UPDATE SET
      tss = excluded.tss,
      sets = excluded.sets
  `);
  stmt.run(dayKey, exercise, tss, sets);
}

function getTSSBreakdown(fromKey, toKey) {
  return db.prepare('SELECT * FROM tss_breakdown WHERE day_key >= ? AND day_key <= ? ORDER BY day_key, exercise').all(fromKey, toKey);
}

function getFirstAndLastDay() {
  const first = db.prepare('SELECT MIN(day_key) as first FROM workout_sets').get();
  const last = db.prepare('SELECT MAX(day_key) as last FROM workout_sets').get();
  return { firstDay: first.first, lastDay: last.last };
}

function closeDatabase() {
  if (db) db.close();
}

function getDb() {
  return db;
}

module.exports = {
  initDatabase,
  insertSet,
  insertSets,
  upsertDailyMetric,
  insertPlateauEvent,
  getSetsByDay,
  getSetsByDayAndExercise,
  getAllDayKeys,
  getAllDayKeysForExercise,
  getDistinctExercises,
  getAllDailyMetrics,
  getMetricsByDayRange,
  getDailyTSSForDay,
  getDailyMetricsForDay,
  getLatestMetric,
  getAllPlateauEvents,
  getAggregateStats,
  getFirstAndLastDay,
  closeDatabase,
  getDb,
  upsertTSSBreakdown,
  getTSSBreakdown
};
