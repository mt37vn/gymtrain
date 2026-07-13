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

    CREATE TABLE IF NOT EXISTS programs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      weeks       INTEGER DEFAULT 4,
      created_at  TEXT DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS program_days (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id  INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
      day_number  INTEGER NOT NULL,
      name        TEXT
    );

    CREATE TABLE IF NOT EXISTS program_exercises (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id          INTEGER NOT NULL REFERENCES program_days(id) ON DELETE CASCADE,
      exercise_name   TEXT NOT NULL,
      sets            INTEGER NOT NULL DEFAULT 3,
      min_reps        INTEGER NOT NULL DEFAULT 8,
      min_increment   REAL NOT NULL DEFAULT 2.5
    );

    CREATE INDEX IF NOT EXISTS idx_program_days ON program_days(program_id);
    CREATE INDEX IF NOT EXISTS idx_program_exercises ON program_exercises(day_id);
  `);

  try { db.exec('ALTER TABLE programs ADD COLUMN days_per_week INTEGER'); } catch (_) {}
  try { db.exec('ALTER TABLE program_exercises DROP COLUMN max_reps'); } catch (_) {}
  try { db.exec('ALTER TABLE program_exercises DROP COLUMN rir'); } catch (_) {}
  try { db.exec("ALTER TABLE program_exercises ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
  try { db.exec('UPDATE program_exercises SET sort_order = id WHERE sort_order = 0'); } catch (_) {}
  try { db.exec("ALTER TABLE program_days ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"); } catch (_) {}
  try { db.exec('UPDATE program_days SET sort_order = id WHERE sort_order = 0'); } catch (_) {}
  try { db.exec('ALTER TABLE daily_metrics ADD COLUMN total_effective_sets INTEGER DEFAULT 0'); } catch (_) {}
  try { db.exec("ALTER TABLE program_exercises ADD COLUMN use_lb_inc INTEGER DEFAULT 0"); } catch (_) {}
  try { db.exec('UPDATE program_exercises SET use_lb_inc = 0 WHERE use_lb_inc IS NULL'); } catch (_) {}
  try { db.exec('ALTER TABLE daily_metrics ADD COLUMN total_warmup_sets INTEGER DEFAULT 0'); } catch (_) {}
  try { db.exec('UPDATE daily_metrics SET total_warmup_sets = 0 WHERE total_warmup_sets IS NULL'); } catch (_) {}
  try { db.exec("ALTER TABLE programs ADD COLUMN day_offsets TEXT"); } catch (_) {}
  try { db.exec("ALTER TABLE programs ADD COLUMN schedule_mode TEXT DEFAULT 'week'"); } catch (_) {}
  try { db.exec('UPDATE programs SET schedule_mode = \'week\' WHERE schedule_mode IS NULL'); } catch (_) {}
  try { db.exec("ALTER TABLE programs ADD COLUMN schedule_data TEXT"); } catch (_) {}

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
    INSERT INTO daily_metrics (day_key, daily_tss, ctl, atl, tsb, m, pr, weight_mult, rm1_predicted, deload_warning, plateau_hit, anabolism, catabolism, total_sets, total_effective_sets, total_warmup_sets)
    VALUES (@day_key, @daily_tss, @ctl, @atl, @tsb, @m, @pr, @weight_mult, @rm1_predicted, @deload_warning, @plateau_hit, @anabolism, @catabolism, @total_sets, @total_effective_sets, @total_warmup_sets)
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
      total_sets = @total_sets,
      total_effective_sets = @total_effective_sets,
      total_warmup_sets = @total_warmup_sets
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
  return db.prepare(`
    SELECT exercise FROM workout_sets
    GROUP BY exercise
    ORDER BY COUNT(*) DESC, exercise
  `).all();
}

function getLastSetReps(exercise) {
  return db.prepare('SELECT weight, reps FROM workout_sets WHERE exercise = ? AND is_warmup = 0 AND weight > 0 AND reps > 0 ORDER BY day_key DESC, id DESC LIMIT 1').get(exercise) || null;
}

function setExists(startMs, exercise, reps, weight) {
  const row = db.prepare('SELECT id FROM workout_sets WHERE start_ms = ? AND exercise = ? AND reps = ? AND weight = ? LIMIT 1').get(startMs, exercise, reps, weight);
  return !!row;
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

function getRecentDailyMetrics(limit) {
  return db.prepare('SELECT day_key, daily_tss, tsb FROM daily_metrics ORDER BY day_key DESC LIMIT ?').all(limit).reverse();
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

function getTrainingDayDetails(fromKey, toKey) {
  return db.prepare(`
    SELECT day_key, exercise, weight, reps, sets, tss, workout
    FROM (
      SELECT
        ws.day_key,
        ws.exercise,
        ws.weight,
        ws.reps,
        ws.workout,
        COUNT(*) OVER (PARTITION BY ws.day_key, ws.exercise) as sets,
        COALESCE(tb.tss, 0) as tss,
        ROW_NUMBER() OVER (PARTITION BY ws.day_key, ws.exercise ORDER BY ws.weight DESC, ws.id DESC) as rn
      FROM workout_sets ws
      LEFT JOIN tss_breakdown tb ON tb.day_key = ws.day_key AND tb.exercise = ws.exercise
      WHERE ws.day_key >= ? AND ws.day_key <= ?
    )
    WHERE rn = 1
    ORDER BY day_key, exercise
  `).all(fromKey, toKey);
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

function getWorkingSets() {
  return db.prepare("SELECT * FROM workout_sets WHERE is_warmup = 0 ORDER BY exercise, day_key").all();
}

function updateSet(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(id);
  db.prepare(`UPDATE workout_sets SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function deleteSet(id) {
  db.prepare('DELETE FROM workout_sets WHERE id = ?').run(id);
}

/* ─── Program CRUD ─── */

function createProgram(name, weeks, scheduleMode) {
  const id = db.prepare('INSERT INTO programs (name, weeks, schedule_mode) VALUES (?, ?, ?)').run(name, weeks, scheduleMode || 'week').lastInsertRowid;
  if (scheduleMode === 'week') {
    const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (let i = 0; i < 7; i++) {
      db.prepare('INSERT INTO program_days (program_id, day_number, name, sort_order) VALUES (?, ?, ?, ?)').run(id, i + 1, DAY_NAMES[i], i + 1);
    }
  } else {
    db.prepare('INSERT INTO program_days (program_id, day_number, name, sort_order) VALUES (?, ?, ?, ?)').run(id, 1, 'Day 1', 1);
  }
  return id;
}

function getAllPrograms() {
  const programs = db.prepare('SELECT * FROM programs ORDER BY created_at DESC').all();
  for (const p of programs) {
    p.days = db.prepare('SELECT * FROM program_days WHERE program_id = ? ORDER BY sort_order, day_number').all(p.id);
    for (const d of p.days) {
      d.exercises = db.prepare('SELECT * FROM program_exercises WHERE day_id = ? ORDER BY sort_order, id').all(d.id);
    }
  }
  return programs;
}

function getProgram(id) {
  const p = db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
  if (!p) return null;
  p.days = db.prepare('SELECT * FROM program_days WHERE program_id = ? ORDER BY sort_order, day_number').all(p.id);
  for (const d of p.days) {
    d.exercises = db.prepare('SELECT * FROM program_exercises WHERE day_id = ? ORDER BY sort_order, id').all(d.id);
  }
  return p;
}

function updateProgram(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(id);
  db.prepare(`UPDATE programs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function deleteProgram(id) {
  db.prepare('DELETE FROM programs WHERE id = ?').run(id);
}

function copyProgramDayExercises(sourceDayId, targetDayId) {
  const exercises = db.prepare('SELECT * FROM program_exercises WHERE day_id = ? ORDER BY sort_order, id').all(sourceDayId);
  const insert = db.transaction((exs) => {
    const stmt = db.prepare('INSERT INTO program_exercises (day_id, exercise_name, sets, min_reps, min_increment, sort_order, use_lb_inc) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < exs.length; i++) {
      const ex = exs[i];
      stmt.run(targetDayId, ex.exercise_name, ex.sets, ex.min_reps, ex.min_increment, i + 1, ex.use_lb_inc || 0);
    }
  });
  insert(exercises);
}

function addProgramDay(programId, dayNumber, name) {
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM program_days WHERE program_id = ?').get(programId);
  return db.prepare('INSERT INTO program_days (program_id, day_number, name, sort_order) VALUES (?, ?, ?, ?)').run(programId, dayNumber, name || null, maxSort.m + 1).lastInsertRowid;
}

function updateProgramDay(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(id);
  db.prepare(`UPDATE program_days SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function deleteProgramDay(id) {
  db.prepare('DELETE FROM program_days WHERE id = ?').run(id);
}

function reorderDays(programId, dayIds) {
  const stmt = db.prepare('UPDATE program_days SET sort_order = ? WHERE id = ? AND program_id = ?');
  const update = db.transaction((ids) => {
    for (let i = 0; i < ids.length; i++) {
      stmt.run(i + 1, ids[i], programId);
    }
  });
  update(dayIds);
}

function addProgramExercise(dayId, exerciseName, sets, minReps, minIncrement, useLbInc) {
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM program_exercises WHERE day_id = ?').get(dayId);
  return db.prepare('INSERT INTO program_exercises (day_id, exercise_name, sets, min_reps, min_increment, sort_order, use_lb_inc) VALUES (?, ?, ?, ?, ?, ?, ?)').run(dayId, exerciseName, sets, minReps, minIncrement, maxSort.m + 1, useLbInc ? 1 : 0).lastInsertRowid;
}

function updateProgramExercise(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  vals.push(id);
  db.prepare(`UPDATE program_exercises SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

function deleteProgramExercise(id) {
  db.prepare('DELETE FROM program_exercises WHERE id = ?').run(id);
}

function reorderExercises(dayId, exerciseIds) {
  const stmt = db.prepare('UPDATE program_exercises SET sort_order = ? WHERE id = ? AND day_id = ?');
  const update = db.transaction((ids) => {
    for (let i = 0; i < ids.length; i++) {
      stmt.run(i + 1, ids[i], dayId);
    }
  });
  update(exerciseIds);
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
  getLastSetReps,
  setExists,
  getAllDailyMetrics,
  getMetricsByDayRange,
  getDailyTSSForDay,
  getDailyMetricsForDay,
  getRecentDailyMetrics,
  getLatestMetric,
  getAllPlateauEvents,
  getAggregateStats,
  getFirstAndLastDay,
  closeDatabase,
  getDb,
  upsertTSSBreakdown,
  getTSSBreakdown,
  getTrainingDayDetails,
  getWorkingSets,
  updateSet,
  deleteSet,
  createProgram,
  getAllPrograms,
  getProgram,
  updateProgram,
  deleteProgram,
  copyProgramDayExercises,
  addProgramDay,
  updateProgramDay,
  deleteProgramDay,
  reorderDays,
  addProgramExercise,
  updateProgramExercise,
  deleteProgramExercise,
  reorderExercises
};
