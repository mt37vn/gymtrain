async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

function formatNum(v, d) {
  if (d === undefined) d = 1;
  if (v === null || v === undefined) return '—';
  return Number(v).toFixed(d);
}

let chartInstances = {};

function destroyCharts() {
  Object.values(chartInstances).forEach(c => { if (c) c.destroy(); });
  chartInstances = {};
}

function buildQueryString() {
  const params = new URLSearchParams();
  const days = getSelectedDays();
  const exercise = document.getElementById('exercise-select').value;
  if (days) params.set('days', days);
  if (exercise) params.set('exercise', exercise);
  const qs = params.toString();
  return qs ? '?' + qs : '';
}

function getSelectedDays() {
  const val = document.getElementById('time-range').value;
  if (!val) return '';
  if (val === 'year') {
    const d = new Date();
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    return Math.floor((d - startOfYear) / (1000 * 60 * 60 * 24));
  }
  return val;
}

async function render() {
  const qs = buildQueryString();
  const exercise = document.getElementById('exercise-select').value;

  const [summary, timeline, plateaus, stats] = await Promise.all([
    fetchJSON('/api/summary' + qs),
    fetchJSON('/api/timeline' + qs),
    fetchJSON('/api/plateaus'),
    fetchJSON('/api/stats')
  ]);

  if (summary.error) {
    document.querySelector('main').innerHTML = '<p style="padding:40px;color:#f85149;">No data available for the selected filter.</p>';
    return;
  }

  const sec = document.querySelector('main');
  if (sec.querySelector('.no-data')) sec.querySelector('.no-data')?.remove();

  document.getElementById('stats-bar').textContent =
    `${stats.totalSets} sets · ${stats.totalDays} days`;

  const cards = document.getElementById('summary-cards');
  const exerciseLabel = exercise ? exercise : 'Global';
  cards.innerHTML = `
    <div class="card"><h3>CTL</h3><div class="value positive">${formatNum(summary.ctl)}</div></div>
    <div class="card"><h3>ATL</h3><div class="value negative">${formatNum(summary.atl)}</div></div>
    <div class="card"><h3>TSB</h3><div class="value ${summary.tsb >= 0 ? 'positive' : 'negative'}">${formatNum(summary.tsb)}</div></div>
    <div class="card"><h3>M (${exerciseLabel})</h3><div class="value neutral">${formatNum(summary.m, 4)}</div></div>
    <div class="card"><h3>PR (${exerciseLabel})</h3><div class="value positive">${formatNum(summary.pr, 1)} kg</div></div>
    <div class="card"><h3>1RM Pred (${exerciseLabel})</h3><div class="value positive">${formatNum(summary.rm1_predicted, 1)} kg</div></div>
    <div class="card"><h3>Weight Mult</h3><div class="value neutral">${formatNum(summary.weight_mult, 3)}</div></div>
    <div class="card"><h3>Daily TSS</h3><div class="value neutral">${formatNum(summary.daily_tss, 1)}</div></div>
  `;

  const alertsEl = document.getElementById('alerts');
  alertsEl.innerHTML = '';
  if (summary.deload_warning) {
    alertsEl.innerHTML += '<div class="alert deload">⚠ Deload recommended — TSB is critically low</div>';
  }
  if (plateaus.length > 0) {
    const last = plateaus[plateaus.length - 1];
    alertsEl.innerHTML += `<div class="alert plateau">&#x1F4C8; Plateau detected on ${last.day_key}: Weight Mult ${formatNum(last.old_mult, 3)} → ${formatNum(last.new_mult, 3)}</div>`;
  }

  const labels = timeline.map(d => d.day_key);
  const ctlData = timeline.map(d => d.ctl);
  const atlData = timeline.map(d => d.atl);
  const tsbData = timeline.map(d => d.tsb);
  const mData = timeline.map(d => d.m);
  const prData = timeline.map(d => d.pr);
  const rm1Data = timeline.map(d => d.rm1_predicted);
  const tssData = timeline.map(d => d.daily_tss);

  const commonOpts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { labels: { color: '#c9d1d9' } } },
    scales: {
      x: { ticks: { color: '#8b949e', maxTicksLimit: 20 }, grid: { color: '#21262d' } },
      y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } }
    }
  };

  destroyCharts();

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
    options: commonOpts
  });

  chartInstances.muscle = new Chart(document.getElementById('muscleChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: `M (${exercise || 'Global'})`, data: mData, borderColor: '#58a6ff', backgroundColor: 'rgba(88,166,255,0.1)', fill: true, tension: 0.3, pointRadius: 0 }]
    },
    options: commonOpts
  });

  chartInstances.rm = new Chart(document.getElementById('rmChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: `PR (${exercise || 'Global'})`, data: prData, borderColor: '#3fb950', tension: 0.3, pointRadius: 0 },
        { label: `1RM Pred (${exercise || 'Global'})`, data: rm1Data, borderColor: '#bc8cff', tension: 0.3, pointRadius: 0 }
      ]
    },
    options: commonOpts
  });

  chartInstances.tss = new Chart(document.getElementById('tssChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'TSS', data: tssData, backgroundColor: tssData.map(v => v > 0 ? 'rgba(63,185,80,0.6)' : 'rgba(48,54,61,0.3)'), borderRadius: 2 }]
    },
    options: { ...commonOpts, scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, beginAtZero: true } } }
  });

  const tbody = document.querySelector('#plateau-table tbody');
  tbody.innerHTML = (exercise ? [] : plateaus).map(p =>
    `<tr><td>${p.day_key}</td><td>${formatNum(p.old_mult, 3)}</td><td>${formatNum(p.new_mult, 3)}</td></tr>`
  ).join('');
}

async function init() {
  const exercises = await fetchJSON('/api/exercises');
  const sel = document.getElementById('exercise-select');
  for (const ex of exercises) {
    const opt = document.createElement('option');
    opt.value = ex;
    opt.textContent = ex;
    sel.appendChild(opt);
  }

  document.getElementById('time-range').addEventListener('change', render);
  document.getElementById('exercise-select').addEventListener('change', render);

  render();
}

document.addEventListener('DOMContentLoaded', init);
