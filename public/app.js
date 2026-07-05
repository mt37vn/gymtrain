/* ─── Utilities ─── */
async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

function formatNum(v, d) {
  if (d === undefined) d = 1;
  if (v === null || v === undefined) return '—';
  return Number(v).toFixed(d);
}

function getSelectedDays(selId) {
  const val = document.getElementById(selId || 'time-range').value;
  if (!val) return '';
  if (val === 'year') {
    const d = new Date();
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    return Math.floor((d - startOfYear) / (1000 * 60 * 60 * 24));
  }
  return val;
}

/* ─── Chart lifecycle ─── */
let chartInstances = {};

function destroyCharts(keep) {
  const keepSet = new Set(keep || []);
  for (const key of Object.keys(chartInstances)) {
    if (!keepSet.has(key) && chartInstances[key]) {
      chartInstances[key].destroy();
      delete chartInstances[key];
    }
  }
}

/* ─── Shared chart options ─── */
function commonOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { labels: { color: '#c9d1d9' } } },
    scales: {
      x: { ticks: { color: '#8b949e', maxTicksLimit: 20 }, grid: { color: '#21262d' } },
      y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } }
    }
  };
}

/* ════════════════════════════════════════════════════
   TAB: TSS (Global)
   ════════════════════════════════════════════════════ */
async function renderTSS() {
  const days = getSelectedDays('time-range');
  const qs = days ? '?days=' + days : '';

  const [summary, timeline, stats] = await Promise.all([
    fetchJSON('/api/summary' + qs),
    fetchJSON('/api/timeline' + qs),
    fetchJSON('/api/stats')
  ]);

  if (summary.error) {
    document.getElementById('tab-tss').innerHTML =
      '<p style="padding:20px;color:#f85149;">No data available.</p>';
    return;
  }

  document.getElementById('stats-bar').textContent =
    `${stats.totalSets} sets · ${stats.totalDays} days`;

  /* Summary cards */
  document.getElementById('summary-cards-tss').innerHTML = `
    <div class="card"><h3>CTL</h3><div class="value positive">${formatNum(summary.ctl)}</div></div>
    <div class="card"><h3>ATL</h3><div class="value negative">${formatNum(summary.atl)}</div></div>
    <div class="card"><h3>TSB</h3><div class="value ${summary.tsb >= 0 ? 'positive' : 'negative'}">${formatNum(summary.tsb)}</div></div>
    <div class="card"><h3>Daily TSS</h3><div class="value neutral">${formatNum(summary.daily_tss, 1)}</div></div>
  `;

  /* Deload alert */
  document.getElementById('alerts-tss').innerHTML =
    summary.deload_warning
      ? '<div class="alert deload">⚠ Deload recommended — TSB is critically low</div>'
      : '';

  const labels = timeline.map(d => d.day_key);
  const ctlData = timeline.map(d => d.ctl);
  const atlData = timeline.map(d => d.atl);
  const tsbData = timeline.map(d => d.tsb);
  const tssData = timeline.map(d => d.daily_tss);

  destroyCharts(['fatigue', 'tss']);

  chartInstances.fatigue = new Chart(document.getElementById('fatigueChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'CTL', data: ctlData, borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,0.1)', fill: true, tension: 0.3, pointRadius: 0 },
        { label: 'ATL', data: atlData, borderColor: '#f85149', backgroundColor: 'rgba(248,81,73,0.1)', fill: true, tension: 0.3, pointRadius: 0 },
        { label: 'TSB', data: tsbData, borderColor: '#d29922', borderDash: [5,5], tension: 0.3, pointRadius: 0 }
      ]
    },
    options: commonOpts()
  });

  chartInstances.tss = new Chart(document.getElementById('tssChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'TSS', data: tssData, backgroundColor: tssData.map(v => v > 0 ? 'rgba(63,185,80,0.6)' : 'rgba(48,54,61,0.3)'), borderRadius: 2 }]
    },
    options: { ...commonOpts(), scales: { ...commonOpts().scales, y: { ...commonOpts().scales.y, beginAtZero: true } } }
  });
}

/* ════════════════════════════════════════════════════
   TAB: Muscle Dynamic (Exercise-specific)
   ════════════════════════════════════════════════════ */
async function renderMuscle() {
  const exercise = document.getElementById('exercise-select').value;
  if (!exercise) {
    /* No exercise selected — show prompt */
    document.getElementById('summary-cards-muscle').innerHTML = '';
    document.getElementById('alerts-muscle').innerHTML =
      '<div class="alert info">Select an exercise above to view muscle dynamics.</div>';
    document.getElementById('plateau-section').querySelector('tbody').innerHTML = '';
    destroyCharts(['muscle', 'rm']);
    /* Show empty charts */
    const opts = commonOpts();
    ['muscleChart', 'rmChart'].forEach(id => {
      const el = document.getElementById(id);
      if (chartInstances[id.replace('Chart', '')]) {
        chartInstances[id.replace('Chart', '')].destroy();
      }
      chartInstances[id.replace('Chart', '')] = new Chart(el, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: opts
      });
    });
    return;
  }

  const days = getSelectedDays('time-range-2');
  const qs = '?exercise=' + encodeURIComponent(exercise) + (days ? '&days=' + days : '');

  const [summary, timeline] = await Promise.all([
    fetchJSON('/api/summary' + qs),
    fetchJSON('/api/timeline' + qs)
  ]);

  if (summary.error) {
    document.getElementById('summary-cards-muscle').innerHTML = '';
    document.getElementById('alerts-muscle').innerHTML =
      '<div class="alert info">No data for this exercise in the selected range.</div>';
    return;
  }

  const el = document.getElementById('exercise-select');
  const exerciseLabel = el.options[el.selectedIndex].text;

  document.getElementById('summary-cards-muscle').innerHTML = `
    <div class="card"><h3>M (${exerciseLabel})</h3><div class="value neutral">${formatNum(summary.m, 4)}</div></div>
    <div class="card"><h3>PR (${exerciseLabel})</h3><div class="value positive">${formatNum(summary.pr, 1)} kg</div></div>
    <div class="card"><h3>1RM Pred (${exerciseLabel})</h3><div class="value positive">${formatNum(summary.rm1_predicted, 1)} kg</div></div>
    <div class="card"><h3>Weight Mult</h3><div class="value neutral">${formatNum(summary.weight_mult, 3)}</div></div>
  `;

  /* Plateau alert */
  const alertsEl = document.getElementById('alerts-muscle');
  if (summary.plateau_hit) {
    alertsEl.innerHTML = '<div class="alert plateau">&#x1F4C8; Plateau detected — Weight Mult increased to ' + formatNum(summary.weight_mult, 3) + '</div>';
  } else {
    alertsEl.innerHTML = '';
  }

  const labels = timeline.map(d => d.day_key);
  const mData = timeline.map(d => d.m);
  const prData = timeline.map(d => d.pr);
  const rm1Data = timeline.map(d => d.rm1_predicted);

  destroyCharts(['muscle', 'rm']);

  chartInstances.muscle = new Chart(document.getElementById('muscleChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: `M (${exerciseLabel})`, data: mData, borderColor: '#58a6ff', backgroundColor: 'rgba(88,166,255,0.1)', fill: true, tension: 0.3, pointRadius: 0 }]
    },
    options: commonOpts()
  });

  chartInstances.rm = new Chart(document.getElementById('rmChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: `PR (${exerciseLabel})`, data: prData, borderColor: '#3fb950', tension: 0.3, pointRadius: 0 },
        { label: `1RM Pred (${exerciseLabel})`, data: rm1Data, borderColor: '#bc8cff', tension: 0.3, pointRadius: 0 }
      ]
    },
    options: commonOpts()
  });

  /* Plateau events table */
  const tbody = document.querySelector('#plateau-table tbody');
  const plateauRows = [];
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].plateau_hit) {
      const prev = i > 0 ? timeline[i - 1].weight_mult : 1.0;
      plateauRows.push({ day_key: timeline[i].day_key, old_mult: prev, new_mult: timeline[i].weight_mult });
    }
  }
  tbody.innerHTML = plateauRows.map(p =>
    `<tr><td>${p.day_key}</td><td>${formatNum(p.old_mult, 3)}</td><td>${formatNum(p.new_mult, 3)}</td></tr>`
  ).join('');
}

/* ════════════════════════════════════════════════════
   Tab switching
   ════════════════════════════════════════════════════ */
let currentTab = 'tss';

function switchTab(tabId) {
  if (tabId === currentTab) return;
  currentTab = tabId;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.toggle('active', el.id === 'tab-' + tabId);
  });

  if (tabId === 'tss') {
    renderTSS();
  } else {
    renderMuscle();
  }
}

/* ════════════════════════════════════════════════════
   Init
   ════════════════════════════════════════════════════ */
async function init() {
  /* Tab click handlers */
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  /* TSS controls */
  document.getElementById('time-range').addEventListener('change', renderTSS);

  /* Muscle controls */
  document.getElementById('time-range-2').addEventListener('change', renderMuscle);

  const exercises = await fetchJSON('/api/exercises');
  const sel = document.getElementById('exercise-select');
  for (const ex of exercises) {
    const opt = document.createElement('option');
    opt.value = ex;
    opt.textContent = ex;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', renderMuscle);

  /* Sync 2nd time range selector with 1st */
  document.getElementById('time-range').addEventListener('change', () => {
    document.getElementById('time-range-2').value = document.getElementById('time-range').value;
  });
  document.getElementById('time-range-2').addEventListener('change', () => {
    document.getElementById('time-range').value = document.getElementById('time-range-2').value;
  });

  /* Initial render */
  renderTSS();
}

document.addEventListener('DOMContentLoaded', init);
