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

function computeWeightRIR3(pre, reps) {
  return Math.ceil(pre * 30 / (34 + reps) * 10) / 10;
}
function computeWeightRIR0(pre, reps) {
  return Math.floor(pre * 30 / (30 + reps) * 10) / 10;
}
function convert1RMToWeight(rm1, reps) {
  if (!rm1 || rm1 <= 0 || !reps || reps < 1) return 0;
  return rm1 * 30 / (30 + reps);
}

function getTimeRange(prefix) {
  const selId = prefix === 'muscle' ? 'time-range-2' : 'time-range';
  const fromId = prefix === 'muscle' ? 'date-from-muscle' : 'date-from-tss';
  const toId = prefix === 'muscle' ? 'date-to-muscle' : 'date-to-tss';

  const from = document.getElementById(fromId).value;
  const to = document.getElementById(toId).value;
  if (from && to) return { days: '', from, to };

  const val = document.getElementById(selId).value;
  if (!val) return { days: '', from: '', to: '' };
  if (val === 'year') {
    const d = new Date();
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d - startOfYear) / (1000 * 60 * 60 * 24));
    return { days: String(days), from: '', to: '' };
  }
  return { days: val, from: '', to: '' };
}

/* ─── Training status ─── */
function trainingStatus(tsb, fitness, detrainTh, overtrainTh) {
  if (fitness <= 0) return { label: 'Detrain', cls: 'detrain', desc: 'No training load detected' };
  const tsbPct = (tsb / fitness) * 100;
  if (tsbPct > (detrainTh || 20)) return { label: 'Detrain', cls: 'detrain', desc: 'Low training load — consider increasing volume' };
  if (tsbPct >= 0) return { label: 'Deload', cls: 'deload', desc: 'Recovery zone — moderate training recommended' };
  if (tsbPct >= (overtrainTh || -20)) return { label: 'Productive', cls: 'productive', desc: 'Optimal load — good adaptation' };
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
    const { ctx, chartArea: { left, right, top, bottom }, scales } = chart;
    if (!left || !scales) return;

    // Vẽ nền dọc theo training status
    const pluginOpts = chart.options.plugins && chart.options.plugins.fatigueZones;
    const statusColors = pluginOpts && pluginOpts.statusColors;
    if (statusColors && statusColors.length > 1 && scales.x && scales.y) {
      const { x, y } = scales;
      const colorMap = {
        'detrain': 'rgba(139,148,158,0.08)',
        'deload': 'rgba(88,166,255,0.08)',
        'productive': 'rgba(63,185,80,0.08)',
        'overtrain': 'rgba(248,81,73,0.10)'
      };
      const dataLen = chart.data.labels.length;
      ctx.save();
      for (let i = 0; i < Math.min(statusColors.length - 1, dataLen - 1); i++) {
        if (!statusColors[i + 1]) continue;
        const x1 = Math.max(left, x.getPixelForValue(chart.data.labels[i]));
        const x2 = Math.min(right, x.getPixelForValue(chart.data.labels[i + 1]));
        if (x2 > x1) {
          ctx.fillStyle = colorMap[statusColors[i + 1]] || 'transparent';
          ctx.fillRect(x1, top, x2 - x1, bottom - top);
        }
      }
      ctx.restore();
    }
  }
};

// Đăng ký plugin toàn cục để cả TSS tab và Muscle tab đều dùng
if (typeof Chart !== 'undefined') Chart.register(fatigueZonePlugin);

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
  const tr = getTimeRange('tss');
  const qs = tr.from && tr.to ? '?from=' + tr.from + '&to=' + tr.to
    : tr.days ? '?days=' + tr.days : '';

  const [summary, timeline, stats, params] = await Promise.all([
    fetchJSON('/api/summary' + qs),
    fetchJSON('/api/timeline' + qs),
    fetchJSON('/api/stats'),
    fetchJSON('/api/params')
  ]);

  if (summary.error) {
    document.getElementById('tab-tss').innerHTML =
      '<p style="padding:20px;color:#f85149;">No data available.</p>';
    return;
  }

  const detrainTh = params.detrain_threshold || 20;
  const overtrainTh = params.overtrain_threshold || -20;

  const brkFrom = timeline.length > 0 ? timeline[0].day_key : '';
  const brkTo = timeline.length > 0 ? timeline[timeline.length - 1].day_key : '';
  const brkQs = brkFrom && brkTo ? '?from=' + brkFrom + '&to=' + brkTo : '';
  const breakdown = brkQs ? await fetchJSON('/api/tss-breakdown' + brkQs) : [];

  document.getElementById('stats-bar').textContent =
    `${stats.totalSets} sets · ${stats.totalDays} days`;

  /* Training status */
  const status = trainingStatus(summary.tsb, summary.ctl, detrainTh, overtrainTh);

  /* Summary cards */
  document.getElementById('summary-cards-tss').innerHTML = `
    <div class="card">
      <h3>Training Status</h3>
      <div class="value ${status.cls}">${status.label}</div>
      <div class="hint">${status.desc}</div>
    </div>
    <div class="card"><h3>Fitness (6w SMA)</h3><div class="value positive">${formatNum(summary.ctl)}</div></div>
    <div class="card"><h3>Fatigue (1w SMA)</h3><div class="value negative">${formatNum(summary.atl)}</div></div>
    <div class="card"><h3>TSB (% Fitness)</h3><div class="value ${summary.tsb >= 0 ? 'positive' : 'negative'}">${formatNum(summary.ctl > 0 ? (summary.tsb / summary.ctl) * 100 : 0, 1)}%</div></div>
    <div class="card"><h3>TSB</h3><div class="value ${summary.tsb >= 0 ? 'positive' : 'negative'}">${formatNum(summary.tsb, 1)}</div></div>
  `;

  const labels = timeline.map(d => d.day_key);
  const ctlData = timeline.map(d => d.ctl);
  const atlData = timeline.map(d => d.atl);
  const tsbData = timeline.map(d => d.tsb);
  const tssData = timeline.map(d => d.daily_tss);

  destroyCharts(['fatigue', 'tss']);

  const statusColors = tsbData.map((tsb, i) => trainingStatus(tsb, ctlData[i], detrainTh, overtrainTh).cls);

  chartInstances.fatigue = new Chart(document.getElementById('fatigueChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Fitness (6w SMA)', data: ctlData, borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,0.1)', fill: true, tension: 0.3, pointRadius: 0 },
        { label: 'Fatigue (1w SMA)', data: atlData, borderColor: '#f85149', backgroundColor: 'rgba(248,81,73,0.1)', fill: true, tension: 0.3, pointRadius: 0 },
        { label: 'TSB', data: tsbData, borderColor: '#d29922', borderDash: [5,5], tension: 0.3, pointRadius: 0 }
      ]
    },
    options: {
      ...commonOpts(),
      plugins: {
        ...commonOpts().plugins,
        fatigueZones: { statusColors: statusColors },
        legend: { labels: { color: '#c9d1d9' } }
      },
      interaction: {
        mode: 'index',
        intersect: false
      },
      layout: { padding: { right: 70 } }
    }
  });

  buildLegend('legend-tss', detrainTh, overtrainTh);

  chartInstances.tss = new Chart(document.getElementById('tssChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'TSS', data: tssData, backgroundColor: tssData.map(v => v > 0 ? 'rgba(63,185,80,0.6)' : 'rgba(48,54,61,0.3)'), borderRadius: 2 }]
    },
    options: { ...commonOpts(), scales: { ...commonOpts().scales, y: { ...commonOpts().scales.y, beginAtZero: true } } }
  });

  /* TSS breakdown table */
  const brkTbody = document.querySelector('#tss-breakdown-table tbody');
  if (!breakdown || breakdown.length === 0) {
    brkTbody.innerHTML = '<tr class="empty-msg"><td colspan="4" style="color:#8b949e;text-align:center;padding:16px;">No training days in this range.</td></tr>';
  } else {
    let rows = '';
    for (const d of breakdown) {
      rows += `<tr>
        <td>${d.day_key}</td>
        <td>${d.exercise}</td>
        <td class="num">${d.sets}</td>
        <td class="num">${formatNum(d.tss, 1)}</td>
      </tr>`;
    }
    brkTbody.innerHTML = rows;
  }
}

function buildLegend(containerId, detrainTh, overtrainTh) {
  const dTh = detrainTh || 20;
  const oTh = overtrainTh || -20;
  document.getElementById(containerId).innerHTML = `
    <div class="legend-item"><span class="legend-swatch detrain"></span> Detrain (TSB > ${dTh}% CTL)</div>
    <div class="legend-item"><span class="legend-swatch deload"></span> Deload (TSB 0% to ${dTh}%)</div>
    <div class="legend-item"><span class="legend-swatch productive"></span> Productive (TSB ${oTh}% to 0%)</div>
    <div class="legend-item"><span class="legend-swatch overtrain"></span> Overtrain (TSB < ${oTh}% CTL)</div>
  `;
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
  destroyCharts(['rm']);
    return;
  }

  const tr = getTimeRange('muscle');
  const qs = '?exercise=' + encodeURIComponent(exercise)
    + (tr.from && tr.to ? '&from=' + tr.from + '&to=' + tr.to
      : tr.days ? '&days=' + tr.days : '');

  const [summary, timeline] = await Promise.all([
    fetchJSON('/api/summary' + qs),
    fetchJSON('/api/timeline' + qs),
  ]);

  if (summary.error) {
    document.getElementById('summary-cards-muscle').innerHTML = '';
    document.getElementById('alerts-muscle').innerHTML =
      '<div class="alert info">No data for this exercise in the selected range.</div>';
    return;
  }

  const el = document.getElementById('exercise-select');
  const exerciseLabel = el.options[el.selectedIndex].text;

  const peakPR = timeline.reduce((max, d) => d.catabolism > max ? d.catabolism : max, 0);
  const trainingDays = timeline.filter(d => d.total_sets > 0 && d.pr_actual > 0);
  const lastTraining = trainingDays.length > 0 ? trainingDays[trainingDays.length - 1] : null;
  const lastPR = lastTraining ? lastTraining.pr_actual : 0;
  const currentPR = summary.pr;

  const cardReps = parseInt(document.getElementById('card-reps')?.value, 10) || 8;
  const lastPRPct = peakPR > 0 && lastPR > 0 ? (lastPR / peakPR * 100) : 0;
  const peakConverted = convert1RMToWeight(peakPR, cardReps);
  const lastConverted = convert1RMToWeight(lastPR, cardReps);
  const currentConverted = convert1RMToWeight(currentPR, cardReps);

  document.getElementById('summary-cards-muscle').innerHTML = `
    <div class="card"><h3>Peak PR</h3><div class="value positive">${formatNum(peakConverted, 1)} kg</div><div class="hint">1RM ${formatNum(peakPR, 1)} kg</div></div>
    <div class="card"><h3>Last PR</h3><div class="value neutral">${lastPR > 0 ? formatNum(lastConverted, 1) + ' kg (' + formatNum(lastPRPct, 1) + '%)' : '—'}</div><div class="hint">1RM ${formatNum(lastPR, 1)} kg, of Peak 1RM ${formatNum(peakPR, 1)} kg</div></div>
    <div class="card"><h3>PR dự kiến (${exerciseLabel})</h3><div class="value positive">${formatNum(currentConverted, 1)} kg</div><div class="hint">1RM ${formatNum(currentPR, 1)} kg</div></div>
    <div class="card card-calc">
      <h3>Tạ đề xuất (${cardReps} reps)</h3>
      <span class="value positive" id="calc-weight-inline">${currentPR > 0 ? formatNum(computeWeightRIR3(currentPR, cardReps), 1) + ' - ' + formatNum(computeWeightRIR0(currentPR, cardReps), 1) + ' kg (3RIR → 0RIR)' : '—'}</span>
      <div class="hint">Từ PR dự kiến 1RM ${formatNum(currentPR, 1)} kg</div>
    </div>`;
  document.getElementById('alerts-muscle').innerHTML = '';

  const labels = timeline.map(d => d.day_key);
  const rm1Data = timeline.map(d => d.rm1_predicted > 0 ? d.rm1_predicted : null);
  const prActualData = timeline.map(d => d.pr_actual);

  destroyCharts(['rm']);

  chartInstances.rm = new Chart(document.getElementById('rmChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: `PR dự kiến (${exerciseLabel})`, data: rm1Data, borderColor: '#bc8cff', tension: 0.3, pointRadius: 0, spanGaps: false },
        { label: `PR thực tế (${exerciseLabel})`, data: prActualData, borderColor: '#3fb950', backgroundColor: '#3fb950', showLine: false, pointRadius: 4, pointHoverRadius: 7 }
      ]
    },
    options: commonOpts()
  });

  /* Daily detail table */
  const detailTbody = document.querySelector('#daily-detail-table tbody');
  if (!timeline || timeline.length === 0) {
    detailTbody.innerHTML = '<tr class="empty-msg"><td colspan="9" style="color:#8b949e;text-align:center;padding:16px;">No data.</td></tr>';
  } else {
    let rows = '';
    for (let i = 0; i < timeline.length; i++) {
      const d = timeline[i];
      const growthPct = d.growth_pct || 0;
      const decayPct = d.decay_pct || 0;
      const netPct = d.net_pct || 0;
      const netCls = netPct > 0 ? 'pos' : netPct < 0 ? 'neg' : '';
      const effSets = d.anabolism || 0;
      rows += `<tr>
        <td>${d.day_key}</td>
        <td class="num">${d.total_sets}</td>
        <td class="num">${effSets}</td>
        <td class="num pos">${formatNum(growthPct, 2)}%</td>
        <td class="num neg">${formatNum(decayPct, 2)}%</td>
        <td class="num ${netCls}">${formatNum(netPct, 2)}%</td>
        <td class="num">${formatNum(d.pr, 1)}</td>
        <td class="num">${d.pr_actual > 0 ? formatNum(d.pr_actual, 1) : '—'}</td>
        <td class="num">${formatNum(d.catabolism, 1)}</td>
      </tr>`;
    }
    detailTbody.innerHTML = rows;
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
  { key: 'fitness_window_days', label: 'Fitness Window (days)',            desc: 'Days for long-term fitness SMA.',            group: 'Neural Fatigue (TSS)', min: 14, max: 112, step: 1 },
  { key: 'fatigue_window_days', label: 'Fatigue Window (days)',            desc: 'Days for short-term fatigue SMA.',           group: 'Neural Fatigue (TSS)', min: 3, max: 28, step: 1 },
  { key: 'rir_threshold',       label: 'RIR Threshold',                    desc: 'Max RIR to count as effective set.',         group: 'Muscle Dynamics',     min: 0, max: 5, step: 1 },
  { key: 'effective_window_days', label: 'Effective Window (days)',        desc: 'Days of effective sets to sum for growth.',  group: 'Muscle Dynamics',     min: 1, max: 10, step: 1 },
  { key: 'growth_per_set',      label: 'Growth per Set',                   desc: 'PR growth per effective set.',               group: 'Muscle Dynamics',     min: 0.0001, max: 0.01, step: 0.0001, fmt: '0.0000', default: 0.001 },
  { key: 'max_growth_per_day',  label: 'Max Growth/Day',                   desc: 'Max PR growth per day.',                     group: 'Muscle Dynamics',     min: 0.0001, max: 0.01, step: 0.0001, fmt: '0.0000', default: 0.003 },
  { key: 'decay_per_day',       label: 'Decay per Day',                    desc: 'PR decay per rest day.',                     group: 'Muscle Dynamics',     min: 0.0001, max: 0.01, step: 0.0001, fmt: '0.0000', default: 0.001 },
  { key: 'peak_floor_ratio',    label: 'Peak Floor Ratio',                 desc: 'Fraction of peak PR as minimum floor.',     group: 'Muscle Dynamics',     min: 0.3, max: 0.95, step: 0.01, fmt: '0.00', default: 0.7 },
  { key: 'detrain_threshold',   label: 'Detrain Threshold',                desc: 'TSB % above which = Detrain.',               group: 'Training Zones',     min: 5, max: 50, step: 1 },
  { key: 'overtrain_threshold', label: 'Overtrain Threshold',              desc: 'TSB % below which = Overtrain.',             group: 'Training Zones',     min: -50, max: -5, step: 1 },
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

  function setUpRangeHandlers(selId, fromId, toId, renderFn) {
    const sel = document.getElementById(selId);
    const group = sel.closest('.controls-bar').querySelector('.date-range-group');
    function toggleDateRange() {
      if (sel.value === 'custom') {
        group.style.display = 'flex';
      } else {
        group.style.display = 'none';
        document.getElementById(fromId).value = '';
        document.getElementById(toId).value = '';
      }
      renderFn();
    }
    sel.addEventListener('change', toggleDateRange);
    document.getElementById(fromId).addEventListener('change', () => {
      sel.value = 'custom';
      group.style.display = 'flex';
      renderFn();
    });
    document.getElementById(toId).addEventListener('change', () => {
      sel.value = 'custom';
      group.style.display = 'flex';
      renderFn();
    });
  }

  setUpRangeHandlers('time-range', 'date-from-tss', 'date-to-tss', renderTSS);
  setUpRangeHandlers('time-range-2', 'date-from-muscle', 'date-to-muscle', renderMuscle);

  const exercises = await fetchJSON('/api/exercises');
  const sel = document.getElementById('exercise-select');
  for (const ex of exercises) {
    const opt = document.createElement('option');
    opt.value = ex;
    opt.textContent = ex;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', renderMuscle);

  document.getElementById('card-reps').addEventListener('input', renderMuscle);

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
