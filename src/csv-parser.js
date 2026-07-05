const fs = require('fs');

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseFloatSafe(val) {
  if (!val || val.trim() === '') return null;
  const v = parseFloat(val.trim());
  return isNaN(v) ? null : v;
}

function parseIntSafe(val) {
  if (!val || val.trim() === '') return null;
  const v = parseInt(val.trim(), 10);
  return isNaN(v) ? null : v;
}

function parseBool(val) {
  if (!val || val.trim() === '') return 0;
  const v = val.trim().toLowerCase();
  return (v === 'true' || v === '1' || v === 'yes') ? 1 : 0;
}

const SKIP_EXERCISES = new Set(['Running', 'SkiErg', 'Rowing', 'Cycling', 'Swimming']);

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);

  if (lines.length < 2) {
    throw new Error('CSV file must have a header row and at least one data row');
  }

  const header = parseCSVLine(lines[0]);
  const colIndex = {};
  header.forEach((name, i) => {
    colIndex[name.trim().toLowerCase()] = i;
  });

  const required = ['start', 'exercise', 'reps'];
  for (const col of required) {
    if (!(col in colIndex)) {
      throw new Error(`Required column "${col}" not found in CSV header`);
    }
  }

  const sets = [];
  let skipped = { cardio: 0, zeroReps: 0, other: 0 };

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);

    const getStr = (name) => {
      const idx = colIndex[name];
      return idx !== undefined && idx < fields.length ? fields[idx].trim() : '';
    };
    const getNum = (name) => parseFloatSafe(getStr(name));
    const getInt = (name) => parseIntSafe(getStr(name));

    const exercise = getStr('exercise');
    if (!exercise) { skipped.other++; continue; }

    if (SKIP_EXERCISES.has(exercise)) { skipped.cardio++; continue; }

    const reps = getInt('reps');
    if (reps === null || reps === 0) { skipped.zeroReps++; continue; }

    const startMs = getInt('start');
    if (startMs === null) { skipped.other++; continue; }

    let weight = getNum('weight');
    const bodyweight = getNum('bodyweight');
    const isBodyweightExercise = (weight === null) && (bodyweight !== null);
    if (isBodyweightExercise) {
      weight = bodyweight;
    }
    if (weight === null) { skipped.other++; continue; }

    const workout = getStr('workout');
    const endMs = getInt('end');
    const warmup = parseBool(getStr('warmup'));
    const max = parseBool(getStr('max'));
    const fail = parseBool(getStr('fail'));

    const dayKey = new Date(startMs).toISOString().slice(0, 10);

    sets.push({
      workout,
      start_ms: startMs,
      end_ms: endMs,
      exercise,
      weight,
      bodyweight,
      reps,
      is_warmup: warmup,
      is_max: max,
      is_fail: fail,
      day_key: dayKey
    });
  }

  return { sets, skipped };
}

module.exports = { parseCSV };
