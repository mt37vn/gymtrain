const fs = require('fs');
const path = require('path');

const USER_PATH = path.join(__dirname, '..', 'params.json');
const DEFAULT_PATH = path.join(__dirname, '..', 'params-default.json');

let _cached = null;

function getParams() {
  if (_cached) return _cached;
  try {
    _cached = JSON.parse(fs.readFileSync(USER_PATH, 'utf-8'));
  } catch {
    const defaults = JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf-8'));
    fs.writeFileSync(USER_PATH, JSON.stringify(defaults, null, 2));
    _cached = defaults;
  }
  return _cached;
}

function saveParams(obj) {
  const current = getParams();
  const merged = { ...current, ...obj };
  fs.writeFileSync(USER_PATH, JSON.stringify(merged, null, 2));
  _cached = merged;
  return merged;
}

function resetParams() {
  const defaults = JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf-8'));
  fs.writeFileSync(USER_PATH, JSON.stringify(defaults, null, 2));
  _cached = defaults;
  return defaults;
}

module.exports = { getParams, saveParams, resetParams };
