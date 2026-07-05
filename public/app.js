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

/* ─── Training status ─── */
function trainingStatus(tsb, ctl) {
  if (ctl <= 0 && tsb === 0) return { label: 'Detrain', cls: 'detrain', desc: 'No training load detected' };
  if (tsb > 20) return { label: 'Detrain', cls: 'detrain', desc: 'Low training load — consider increasing volume' };
  if (tsb >= -10) return { label: 'Productive', cls: 'productive', desc: 'Optimal load — good adaptation' };
  if (tsb >= -30) return { label: 'Strained', cls: 'strained', desc: 'High fatigue — monitor recovery' };
  return { label: 'Overtrain', cls: 'overtrain', desc: 'Excessive load — deload strongly recommended' };
}

/* ─── Chart lifecycle ─── */
let chartInstances = {};

function destroyCharts(keys) {
  for (const key of keys || []) {
    if (chartInstances[key]) {
      chartInstances[key].destroy();
      delete chartInstances[key];
    }
  }
}

/* ─── Fatigue chart zone plugin ─── */
const fatigueZonePlugin = {
  id: 'fatigueZones',
  beforeDraw(chart) {
    const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
    if (!y) return;
    const zones = [
      { min: -Infinity, max: -30, color: 'rgba(248,81,73,0.08)' },
      { min: -30, max: -10, color: 'rgba(210,153,34,0.07)' },
      { min: -10, max: 20, color: 'rgba(63,185,80,0.06)' },
      { min: 20, max: Infinity, color: 'rgba(88,166,255,0.06)' }
    ];
    for (const zone of zones) {
      const y1 = zone.min === -Infinity ? top : Math.max(top, y.getPixelForValue(zone.min));
      const y2 = zone.max === Infinity ? bottom : Math.min(bottom, y.getPixelForValue(zone.max));
      if (y1 < bottom && y2 > top) {
        ctx.fillStyle = zone.color;
        ctx.fillRect(left, y2, right - left, y1 - y2);
      }
    }
    /* Zone labels on the right */
    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    const labels = [
      { y: -35, text: 'Overtrain', color: '#f85149' },
      { y: -20, text: 'Strained', color: '#d29922' },
      { y: 5, text: 'Productive', color: '#3fb950' },
      { y: 30, text: 'Detrain', color: '#58a6ff' }
    ];
    for (const lbl of labels) {
      const py = Math.max(top + 4, Math.min(bottom - 4, y.getPixelForValue(lbl.y)));
      ctx.fillStyle = lbl.color;
      ctx.globalAlpha = 0.5;
      ctx.fillText(lbl.text, right + 6, py + 3);
      ctx.globalAlpha = 1;
    }
  }
};

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

  /* Training status */
  const status = trainingStatus(summary.tsb, summary.ctl);

  /* Summary cards */
  document.getElementById('summary-cards-tss').innerHTML = `
    <div class="card">
      <h3>Training Status</h3>
      <div class="value ${status.cls}">${status.label}</div>
      <div class="hint">${status.desc}</div>
    </div>
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
    options: {
      ...commonOpts(),
      plugins: {
        ...commonOpts().plugins,
        legend: { labels: { color: '#c9d1d9' } }
      },
      /* Reserve extra right margin for zone labels */
      layout: { padding: { right: 70 } }
    },
    plugins: [fatigueZonePlugin]
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
    /* No exercise selected — show prompt, clear charts */
    document.getElementById('summary-cards-muscle').innerHTML = '';
    document.getElementById('alerts-muscle').innerHTML =
      '<div class="alert info">Select an exercise above to view muscle dynamics.</div>';
    document.querySelector('#daily-detail-table tbody').innerHTML = '';
    document.querySelector('#plateau-section tbody').innerHTML = '';
    document.querySelector('#plateau-section tr.empty-msg')?.remove();
    destroyCharts(['muscle', 'rm']);
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

  /* Daily detail table */
  const detailTbody = document.querySelector('#daily-detail-table tbody');
  if (!timeline || timeline.length === 0) {
    detailTbody.innerHTML = '<tr class="empty-msg"><td colspan="7" style="color:#8b949e;text-align:center;padding:16px;">No data.</td></tr>';
  } else {
    let rows = '';
    for (let i = 0; i < timeline.length; i++) {
      const d = timeline[i];
      const prev = i > 0 ? timeline[i - 1] : null;
      const netGain = d.anabolism - d.catabolism;
      const newMuscle = prev ? d.m - prev.m : 0;
      const newRM = prev ? d.rm1_predicted - prev.rm1_predicted : 0;
      const netCls = netGain > 0 ? 'pos' : netGain < 0 ? 'neg' : '';
      const nmCls = newMuscle > 0 ? 'pos' : newMuscle < 0 ? 'neg' : '';
      const rmCls = newRM > 0 ? 'pos' : newRM < 0 ? 'neg' : '';
      rows += `<tr>
        <td>${d.day_key}</td>
        <td class="num">${formatNum(d.anabolism, 5)}</td>
        <td class="num">${formatNum(d.catabolism, 5)}</td>
        <td class="num ${netCls}">${formatNum(netGain, 5)}</td>
        <td class="num ${nmCls}">${formatNum(newMuscle, 5)}</td>
        <td class="num ${rmCls}">${formatNum(newRM, 1)}</td>
        <td class="num">${formatNum(d.pr, 1)}</td>
      </tr>`;
    }
    detailTbody.innerHTML = rows;
  }

  /* Plateau events table */
  const thead = document.querySelector('#plateau-table thead');
  const tbody = document.querySelector('#plateau-table tbody');
  /* Remove old empty-row message if any */
  tbody.querySelector('tr.empty-msg')?.remove();

  const plateauRows = [];
  for (let i = 0; i < timeline.length; i++) {
    if (timeline[i].plateau_hit) {
      const prev = i > 0 ? timeline[i - 1].weight_mult : 1.0;
      plateauRows.push({ day_key: timeline[i].day_key, old_mult: prev, new_mult: timeline[i].weight_mult });
    }
  }

  if (plateauRows.length === 0) {
    thead.style.display = 'none';
    tbody.innerHTML = '<tr class="empty-msg"><td colspan="3" style="color:#8b949e;text-align:center;padding:16px;">No plateau events for this exercise in the selected range.</td></tr>';
  } else {
    thead.style.display = '';
    tbody.innerHTML = plateauRows.map(p =>
      `<tr><td>${p.day_key}</td><td>${formatNum(p.old_mult, 3)}</td><td>${formatNum(p.new_mult, 3)}</td></tr>`
    ).join('');
  }
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
  } else if (tabId === 'muscle') {
    renderMuscle();
  } else if (tabId === 'settings') {
    renderSettings();
  }
}

/* ════════════════════════════════════════════════════
   TAB: Settings
   ════════════════════════════════════════════════════ */

const PARAM_DEFS = [
  { key: 'tau_ctl_days',       label: 'Fitness Time Constant (τ CTL)',   desc: 'Days for long-term fitness averaging.',      group: 'Neural Fatigue (TSS)', min: 7, max: 120, step: 1 },
  { key: 'tau_atl_days',       label: 'Fatigue Time Constant (τ ATL)',   desc: 'Days for short-term fatigue averaging.',     group: 'Neural Fatigue (TSS)', min: 3, max: 28, step: 1 },
  { key: 'm_max_cap',          label: 'Max Meaningful Reps (M_max)',     desc: 'Max reps before set is beyond failure.',     group: 'Neural Fatigue (TSS)', min: 10, max: 100, step: 1 },
  { key: 'k_failure',          label: 'Failure Penalty (k_failure)',     desc: 'Multiplier for reps exceeding M_max.',       group: 'Neural Fatigue (TSS)', min: 1, max: 5, step: 0.1 },
  { key: 'lambda_base',        label: 'Base Catabolism Rate (λ_base)',   desc: 'Daily muscle loss at rest (fraction).',      group: 'Muscle Dynamics',     min: 0.0001, max: 0.01, step: 0.0001, fmt: '0.0000' },
  { key: 'lambda_max',         label: 'Max Catabolism Rate (λ_max)',     desc: 'Max muscle loss under high TSS (fraction).', group: 'Muscle Dynamics',     min: 0.0001, max: 0.02, step: 0.0001, fmt: '0.0000' },
  { key: 'tss_crit',           label: 'Critical TSS (TSS_crit)',         desc: 'Daily TSS where catabolism peaks.',          group: 'Muscle Dynamics',     min: 10, max: 1000, step: 1 },
  { key: 'a_max',              label: 'Max Anabolism Rate (A_max)',      desc: 'Ceiling on daily muscle building.',          group: 'Muscle Dynamics',     min: 0.0001, max: 0.02, step: 0.0001, fmt: '0.0000' },
  { key: 'k_anabolic',         label: 'Anabolic Impulse Coeff (k)',      desc: 'Stimulus per set. Higher = faster gains.',   group: 'Muscle Dynamics',     min: 0.00001, max: 0.01, step: 0.00001, fmt: '0.00000' },
  { key: 'alpha_intensity',    label: 'Intensity Exponent (α)',          desc: 'Sensitivity to weight/PR ratio.',            group: 'Muscle Dynamics',     min: 1, max: 20, step: 0.5 },
  { key: 'm_min',              label: 'Minimum M (M_min)',               desc: 'Floor for M (muscle memory).',               group: 'Muscle Dynamics',     min: 0.001, max: 0.5, step: 0.001, fmt: '0.000' },
  { key: 'pr_window_days',     label: 'PR Rolling Window',               desc: 'Days to look back for PR computation.',      group: 'PR & Detraining',     min: 7, max: 365, step: 1 },
  { key: 'grace_days',         label: 'Detraining Grace (days)',         desc: 'Days before 1RM decay starts.',              group: 'PR & Detraining',     min: 0, max: 60, step: 1 },
  { key: 'tau_decay_days',     label: 'Decay Time Constant (τ_decay)',   desc: 'Time constant for 1RM exponential decay.',   group: 'PR & Detraining',     min: 7, max: 365, step: 1 },
  { key: 'floor_rm',           label: 'Floor RM Ratio',                   desc: 'Fraction of peak 1RM never lost.',           group: 'PR & Detraining',     min: 0.3, max: 0.95, step: 0.01, fmt: '0.00' }
];

function buildParamField(def, currentVal) {
  const decPlaces = def.step < 1 ? (def.fmt ? def.fmt.split('.')[1].length : 4) : 0;
  const valStr = Number(currentVal).toFixed(decPlaces);
  return `
    <div class="param-row">
      <div class="param-info">
        <span class="param-label">${def.label}</span>
        <span class="param-desc">${def.desc}</span>
      </div>
      <div class="param-controls">
        <input type="range" class="param-slider" data-key="${def.key}"
               min="${def.min}" max="${def.max}" step="${def.step}"
               value="${currentVal}">
        <input type="number" class="param-number" data-key="${def.key}"
               min="${def.min}" max="${def.max}" step="${def.step}"
               value="${valStr}">
      </div>
    </div>`;
}

function buildGroupHeading(group) {
  return `<h3 class="param-group-heading">${group}</h3>`;
}

async function renderSettings() {
  const params = await fetchJSON('/api/params');
  let html = '';
  let currentGroup = '';

  for (const def of PARAM_DEFS) {
    if (def.group !== currentGroup) {
      currentGroup = def.group;
      html += buildGroupHeading(currentGroup);
    }
    html += buildParamField(def, params[def.key]);
  }

  document.getElementById('params-form').innerHTML = html;
  document.getElementById('params-status').innerHTML = '';

  document.querySelectorAll('.param-slider').forEach(slider => {
    slider.addEventListener('input', () => {
      const num = document.querySelector(`.param-number[data-key="${slider.dataset.key}"]`);
      if (num) {
        const def = PARAM_DEFS.find(d => d.key === slider.dataset.key);
        const dp = def && def.step < 1 ? (def.fmt ? def.fmt.split('.')[1].length : 4) : 0;
        num.value = Number(slider.value).toFixed(dp);
      }
    });
  });
  document.querySelectorAll('.param-number').forEach(num => {
    num.addEventListener('input', () => {
      const slider = document.querySelector(`.param-slider[data-key="${num.dataset.key}"]`);
      if (slider) {
        const v = parseFloat(num.value);
        if (!isNaN(v) && v >= parseFloat(slider.min) && v <= parseFloat(slider.max)) {
          slider.value = v;
        }
      }
    });
  });

  document.getElementById('btn-save-params').onclick = async () => {
    const updates = {};
    document.querySelectorAll('.param-slider').forEach(s => {
      updates[s.dataset.key] = parseFloat(s.value);
    });
    try {
      const res = await fetch('/api/params', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
      await res.json();
      document.getElementById('params-status').innerHTML =
        '<div class="alert info">Parameters saved to params.json. Restart the server for changes to take effect.</div>';
    } catch (e) {
      document.getElementById('params-status').innerHTML =
        `<div class="alert deload">Error saving: ${e.message}</div>`;
    }
  };

  document.getElementById('btn-reset-params').onclick = async () => {
    try {
      await fetch('/api/params/reset', { method: 'POST' });
      renderSettings();
      document.getElementById('params-status').innerHTML =
        '<div class="alert info">Parameters restored to defaults.</div>';
    } catch (e) {
      document.getElementById('params-status').innerHTML =
        `<div class="alert deload">Error: ${e.message}</div>`;
    }
  };
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
