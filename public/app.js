/* ─── Utilities ─── */
async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  return res.json();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales) return;
    const { left, right, bottom } = chartArea;

    const pluginOpts = chart.options.plugins && chart.options.plugins.fatigueZones;
    const statusColors = pluginOpts && pluginOpts.statusColors;
    if (statusColors && statusColors.length > 1 && scales.x && scales.y) {
      const { x } = scales;
      const colorMap = {
        'detrain': 'rgba(139,148,158,0.9)',
        'deload': 'rgba(88,166,255,0.9)',
        'productive': 'rgba(63,185,80,0.9)',
        'overtrain': 'rgba(248,81,73,0.9)'
      };
      const dataLen = chart.data.labels.length;
      const barHeight = 24;
      const barY = bottom + 4;
      ctx.save();
      for (let i = 0; i < Math.min(statusColors.length - 1, dataLen - 1); i++) {
        if (!statusColors[i + 1]) continue;
        const x1 = Math.max(left, x.getPixelForValue(chart.data.labels[i]));
        const x2 = Math.min(right, x.getPixelForValue(chart.data.labels[i + 1]));
        if (x2 > x1) {
          ctx.fillStyle = colorMap[statusColors[i + 1]] || 'transparent';
          ctx.fillRect(x1, barY, x2 - x1, barHeight);
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
      x: { ticks: { color: '#8b949e', maxTicksLimit: 20, padding: 34 }, grid: { display: false } },
      y: { ticks: { color: '#8b949e' }, grid: { display: false } }
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
        { label: 'Fitness (6w SMA)', data: ctlData, borderColor: '#3fb950', tension: 0.3, pointRadius: 0 },
        { label: 'Fatigue (1w SMA)', data: atlData, borderColor: '#f85149', tension: 0.3, pointRadius: 0 },
        { label: 'Zero', data: Array(labels.length).fill(0), borderColor: 'rgba(201,209,217,0.5)', tension: 0, pointRadius: 0, pointHitRadius: 0, pointHoverRadius: 0 },
        { label: 'TSB', data: tsbData, borderColor: '#d29922', tension: 0.3, pointRadius: 0 }
      ]
    },
    options: {
      ...commonOpts(),
      plugins: {
        ...commonOpts().plugins,
        fatigueZones: { statusColors: statusColors },
        legend: { labels: { color: '#c9d1d9', filter: function(item) { return item.text !== 'Zero'; } } },
        tooltip: {
          mode: 'index',
          intersect: false,
          filter: function(item) { return item.datasetIndex !== 2; },
          callbacks: {
            afterBody: function(items) {
              const idx = items[0].dataIndex;
              const ctl = ctlData[idx];
              const tsb = tsbData[idx];
              const st = trainingStatus(tsb, ctl, detrainTh, overtrainTh);
              const pct = ctl > 0 ? (tsb / ctl * 100) : 0;
              return `Status: ${st.label}\nTSB%: ${pct.toFixed(1)}%`;
            }
          }
        }
      },
      interaction: {
        mode: 'index',
        intersect: false
      },
      layout: { padding: { right: 70, bottom: 60 } }
    }
  });

  buildLegend('legend-tss', detrainTh, overtrainTh);

  const tssAvg = tssData.reduce((a, b) => a + b, 0) / tssData.length || 0;

  chartInstances.tss = new Chart(document.getElementById('tssChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'TSS', data: tssData, backgroundColor: tssData.map(v => v > 0 ? 'rgba(63,185,80,0.6)' : 'rgba(48,54,61,0.3)'), borderRadius: 2 },
        { type: 'line', label: 'Avg', data: Array(labels.length).fill(tssAvg), borderColor: 'rgba(201,209,217,0.7)', borderDash: [4,4], pointRadius: 0, pointHitRadius: 0, pointHoverRadius: 0 }
      ]
    },
    options: {
      ...commonOpts(),
      plugins: {
        legend: { labels: { color: '#c9d1d9', filter: function(item) { return item.text !== 'Avg'; } } },
        tooltip: { mode: 'index', intersect: false, filter: function(item) { return item.datasetIndex !== 1; } }
      },
      scales: { ...commonOpts().scales, y: { ...commonOpts().scales.y, beginAtZero: true } }
    }
  });

  /* TSS breakdown table */
  const brkTbody = document.querySelector('#tss-breakdown-table tbody');
  if (!breakdown || breakdown.length === 0) {
    brkTbody.innerHTML = '<tr class="empty-msg"><td colspan="4" style="color:#8b949e;text-align:center;padding:16px;">No training days in this range.</td></tr>';
  } else {
    let rows = '';
    for (let i = breakdown.length - 1; i >= 0; i--) {
      const d = breakdown[i];
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
  const exercise = document.getElementById('exercise-input').value;
  if (!exercise) {
    /* No exercise selected — show prompt, clear charts */
    document.getElementById('summary-cards-muscle').innerHTML = '';
    document.getElementById('alerts-muscle').innerHTML =
      '<div class="alert info">Select an exercise above to view muscle dynamics.</div>';
    document.querySelector('#daily-detail-table tbody').innerHTML = '';
    destroyCharts(['rm']);
    return;
  }

  const tr = getTimeRange('muscle');
  const qs = '?exercise=' + encodeURIComponent(exercise)
    + (tr.from && tr.to ? '&from=' + tr.from + '&to=' + tr.to
      : tr.days ? '&days=' + tr.days : '');

  const [summary, timeline, params] = await Promise.all([
    fetchJSON('/api/summary' + qs),
    fetchJSON('/api/timeline' + qs),
    fetchJSON('/api/params')
  ]);

  if (summary.error) {
    document.getElementById('summary-cards-muscle').innerHTML = '';
    document.getElementById('alerts-muscle').innerHTML =
      '<div class="alert info">No data for this exercise in the selected range.</div>';
    return;
  }

  const exerciseLabel = document.getElementById('exercise-input').value;

  const peakPR = timeline.reduce((max, d) => d.catabolism > max ? d.catabolism : max, 0);
  const floorRatio = (params && params.peak_floor_ratio) || 0.7;
  const floorPR = peakPR * floorRatio;
  const trainingDays = timeline.filter(d => d.total_sets > 0 && d.pr_actual > 0);
  const lastTraining = trainingDays.length > 0 ? trainingDays[trainingDays.length - 1] : null;
  const lastPR = lastTraining ? lastTraining.pr_actual : 0;
  const currentPR = summary.pr;

  const cardReps = parseInt(document.getElementById('card-reps')?.value, 10) || 8;
  const lastPRPct = peakPR > 0 && lastPR > 0 ? (lastPR / peakPR * 100) : 0;
  const peakConverted = convert1RMToWeight(peakPR, cardReps);
  const floorConverted = convert1RMToWeight(floorPR, cardReps);
  const lastConverted = convert1RMToWeight(lastPR, cardReps);
  const currentConverted = convert1RMToWeight(currentPR, cardReps);
  const suggestedLow = computeWeightRIR3(currentPR, cardReps);
  const suggestedHigh = computeWeightRIR0(currentPR, cardReps);

  const prMin = peakConverted * 0.5;
  const prMax = peakConverted || 1;
  const pct = (v) => v <= prMin ? 0 : (((v - prMin) / (prMax - prMin)) * 100).toFixed(1);

  const lastInRange = lastPR > 0 && suggestedLow > 0 && suggestedHigh > 0
    && lastConverted >= suggestedLow && lastConverted <= suggestedHigh;
  const prdkInRange = currentPR > 0 && suggestedLow > 0 && suggestedHigh > 0
    && currentConverted >= suggestedLow && currentConverted <= suggestedHigh;
  const prdkDotColor = prdkInRange ? '#3fb950' : '#f85149';
  const lastColor = '#d29922';
  const recLowColor = '#3fb950';

  document.getElementById('summary-cards-muscle').innerHTML = `
    <div class="pr-bar-chart">
      <div class="pr-bar-legend">
        <span class="pr-bar-legend-item"><span class="pr-bar-legend-dot" style="background:#bc8cff"></span> Peak</span>
        <span class="pr-bar-legend-item"><span class="pr-bar-legend-dot" style="background:#8b949e"></span> Floor</span>
        <span class="pr-bar-legend-item"><span class="pr-bar-legend-dot" style="background:${lastColor}"></span> Last</span>
        <span class="pr-bar-legend-item"><span class="pr-bar-legend-dot" style="background:rgba(63,185,80,0.5)"></span> Rec</span>
      </div>
      <div class="pr-bar-track-wrap">
        <div class="pr-bar-range" style="left:${pct(floorConverted)}%;width:${(100 - pct(floorConverted))}%"></div>
        ${suggestedLow > 0 && suggestedHigh > 0 ? `<div class="pr-bar-recommend" style="left:${pct(suggestedLow)}%;width:${(pct(suggestedHigh) - pct(suggestedLow))}%"></div>` : ''}
        <div class="pr-marker" style="left:${pct(floorConverted)}%">
          <div class="pr-marker-line" style="background:#8b949e"></div>
          <div class="pr-marker-label" style="color:#8b949e">${formatNum(floorConverted,1)}</div>
        </div>
        <div class="pr-marker" style="left:${pct(peakConverted)}%">
          <div class="pr-marker-line" style="background:#bc8cff"></div>
          <div class="pr-marker-label" style="color:#bc8cff">${formatNum(peakConverted,1)}</div>
        </div>
        ${suggestedLow > 0 ? `<div class="pr-marker" style="left:${pct(suggestedLow)}%">
          <div class="pr-marker-line" style="background:${recLowColor}"></div>
          <div class="pr-marker-label" style="color:${recLowColor}">${formatNum(suggestedLow,1)}</div>
        </div>` : ''}
        ${lastPR > 0 ? `<div class="pr-marker" style="left:${pct(lastConverted)}%">
          <div class="pr-marker-line" style="background:${lastColor}"></div>
          <div class="pr-marker-label pr-marker-label-bottom" style="color:${lastColor}">${formatNum(lastConverted,1)}</div>
        </div>` : ''}
        ${currentPR > 0 ? `<div class="pr-marker" style="left:${pct(currentConverted)}%">
          <div class="pr-marker-line" style="background:#3fb950"></div>
          <div class="pr-marker-label" style="color:#3fb950">${formatNum(currentConverted,1)}</div>
        </div>` : ''}
      </div>
      <div class="pr-bar-scale">
        <span>${formatNum(prMin,1)} (50% Peak)</span>
        <span>${formatNum(prMax,1)} (Peak)</span>
      </div>
      <div class="pr-bar-stats">
        <span class="pr-bar-stat">Peak 1RM: <strong>${formatNum(peakPR,1)} kg</strong></span>
        <span class="pr-bar-stat">Floor 1RM: <strong>${formatNum(floorPR,1)} kg</strong></span>
        <span class="pr-bar-stat">PR DK 1RM: <strong>${formatNum(currentPR,1)} kg</strong></span>
        ${lastPR > 0 ? `<span class="pr-bar-stat">Last 1RM: <strong>${formatNum(lastPR,1)} kg</strong> (${formatNum(lastPRPct,1)}%)</span>` : ''}
        <span class="pr-bar-stat">Reps: <strong>${cardReps}RM</strong></span>
      </div>
    </div>`;
  document.getElementById('alerts-muscle').innerHTML = '';

  const labels = timeline.map(d => d.day_key);
  const repSuffix = ` (${cardReps}RM)`;
  const rm1Data = timeline.map(d => d.rm1_predicted > 0 ? convert1RMToWeight(d.rm1_predicted, cardReps) : null);
  const prActualData = timeline.map(d => d.pr_actual > 0 ? convert1RMToWeight(d.pr_actual, cardReps) : null);
  const recLowData = timeline.map(d => d.rm1_predicted > 0 ? computeWeightRIR3(d.rm1_predicted, cardReps) : null);
  const recHighData = timeline.map(d => d.rm1_predicted > 0 ? computeWeightRIR0(d.rm1_predicted, cardReps) : null);

  let peakSoFar = 0;
  const prActualColors = timeline.map((d, i) => {
    if (d.pr_actual > 0) {
      if (d.pr_actual > peakSoFar) {
        peakSoFar = d.pr_actual;
        return '#bc8cff';
      }
      if (d.rm1_predicted > 0 && d.pr_actual >= d.rm1_predicted) return '#bc8cff';
      if (recLowData[i] !== null && recHighData[i] !== null) {
        const w = convert1RMToWeight(d.pr_actual, cardReps);
        return w >= recLowData[i] && w <= recHighData[i] ? '#3fb950' : '#f85149';
      }
    }
    return 'transparent';
  });

  for (let i = prActualColors.length - 1; i >= 0; i--) {
    if (prActualColors[i] !== 'transparent') {
      prActualColors[i] = '#d29922';
      break;
    }
  }

  destroyCharts(['rm']);

  const chartDatasets = [];

  if (recLowData.some(v => v !== null) && recHighData.some(v => v !== null)) {
    chartDatasets.push(
      { label: 'Rec Low', data: recLowData, borderColor: 'rgba(63,185,80,0.3)', backgroundColor: 'rgba(63,185,80,0.08)', fill: '+1', pointRadius: 0, borderDash: [3, 3] },
      { label: 'Rec High', data: recHighData, borderColor: 'rgba(63,185,80,0.3)', pointRadius: 0, borderDash: [3, 3] }
    );
  }

  chartDatasets.push(
    { label: `PR dự kiến${repSuffix} (${exerciseLabel})`, data: rm1Data, borderColor: '#3fb950', tension: 0.3, pointRadius: 0, spanGaps: false },
    { label: `PR thực tế${repSuffix} (${exerciseLabel})`, data: prActualData, showLine: false, pointRadius: 4, pointHoverRadius: 7, pointBackgroundColor: prActualColors, pointBorderColor: prActualColors }
  );

  chartInstances.rm = new Chart(document.getElementById('rmChart'), {
    type: 'line',
    data: { labels, datasets: chartDatasets },
    options: {
      ...commonOpts(),
      onClick: function(e) {
        const pts = this.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
        if (pts.length === 0) return;
        const idx = pts[0].index;
        const dayKey = labels[idx];
        if (dayKey) showDaySets(exercise, dayKey);
      }
    }
  });

  /* Daily detail table */
  const detailTbody = document.querySelector('#daily-detail-table tbody');
  if (!timeline || timeline.length === 0) {
    detailTbody.innerHTML = '<tr class="empty-msg"><td colspan="9" style="color:#8b949e;text-align:center;padding:16px;">No data.</td></tr>';
  } else {
    let rows = '';
    for (let i = timeline.length - 1; i >= 0; i--) {
      const d = timeline[i];
      const growthPct = d.growth_pct || 0;
      const decayPct = d.decay_pct || 0;
      const netPct = d.net_pct || 0;
      const netCls = netPct > 0 ? 'pos' : netPct < 0 ? 'neg' : '';
      const decayCls = decayPct > 0 ? 'neg' : '';
      const effSets = d.anabolism || 0;
      rows += `<tr>
        <td>${d.day_key}</td>
        <td class="num">${d.total_sets}</td>
        <td class="num">${effSets}</td>
        <td class="num pos">${formatNum(growthPct, 2)}%</td>
        <td class="num ${decayCls}">${formatNum(decayPct, 2)}%</td>
        <td class="num ${netCls}">${formatNum(netPct, 2)}%</td>
        <td class="num">${formatNum(d.pr, 1)}</td>
        <td class="num">${d.pr_actual > 0 ? formatNum(d.pr_actual, 1) : '—'}</td>
        <td class="num">${formatNum(d.catabolism, 1)}</td>
      </tr>`;
    }
    detailTbody.innerHTML = rows;
  }

}

/* ─── Show day sets modal ─── */
async function showDaySets(exercise, dayKey) {
  const modal = document.getElementById('day-sets-modal');
  const body = document.getElementById('day-sets-body');
  document.getElementById('day-sets-title').textContent = `Sets for ${dayKey} — ${exercise}`;
  modal.style.display = 'flex';
  body.innerHTML = '<div class="anomaly-loading">Loading...</div>';

  try {
    const sets = await fetchJSON(`/api/sets?exercise=${encodeURIComponent(exercise)}&date=${encodeURIComponent(dayKey)}`);
    if (!sets || sets.length === 0) {
      body.innerHTML = '<div class="anomaly-empty">No sets found for this day.</div>';
      return;
    }
    let html = `<table class="anomaly-table"><thead><tr>
      <th>#</th><th>Warmup</th><th>Weight</th><th>Reps</th><th>1RM</th><th>Actions</th>
    </tr></thead><tbody>`;
    for (const s of sets) {
      const rm1 = s.weight > 0 && s.reps > 0 ? (s.weight * (1 + s.reps / 30)).toFixed(1) : '—';
      html += `<tr data-id="${s.id}" data-weight="${s.weight}" data-reps="${s.reps}">
        <td>${s.id}</td>
        <td>${s.is_warmup ? 'Yes' : '—'}</td>
        <td class="cell-weight">${s.weight}</td>
        <td class="cell-reps">${s.reps}</td>
        <td>${rm1}</td>
        <td class="anomaly-actions">
          <button class="anomaly-btn edit-btn">Edit</button>
          <button class="anomaly-btn danger del-btn">Delete</button>
        </td>
      </tr>`;
    }
    html += '</tbody></table>';
    body.innerHTML = html;

    body.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tr = btn.closest('tr');
        const weightTd = tr.querySelector('.cell-weight');
        const repsTd = tr.querySelector('.cell-reps');
        const origW = tr.dataset.weight;
        const origR = tr.dataset.reps;

        if (btn.dataset.editing === '1') {
          const newW = parseFloat(weightTd.querySelector('input').value);
          const newR = parseInt(repsTd.querySelector('input').value, 10);
          if (isNaN(newW) || isNaN(newR)) return;
          try {
            await fetch(`/api/sets/${tr.dataset.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weight: newW, reps: newR }) });
            tr.dataset.weight = newW;
            tr.dataset.reps = newR;
            weightTd.textContent = newW;
            repsTd.textContent = newR;
          } catch (e) { alert('Save failed: ' + e.message); return; }
          btn.textContent = 'Edit';
          btn.classList.remove('save');
          btn.dataset.editing = '0';
          tr.querySelector('.cancel-btn')?.remove();
          if (typeof renderMuscle === 'function') renderMuscle();
          showDaySets(exercise, dayKey);
        } else {
          weightTd.innerHTML = `<input class="anomaly-edit-input" type="number" step="0.1" value="${origW}">`;
          repsTd.innerHTML = `<input class="anomaly-edit-input" type="number" value="${origR}">`;
          btn.textContent = 'Save';
          btn.classList.add('save');
          btn.dataset.editing = '1';
          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'anomaly-btn cancel cancel-btn';
          cancelBtn.textContent = 'Cancel';
          btn.parentNode.insertBefore(cancelBtn, btn.nextSibling);
          cancelBtn.addEventListener('click', () => {
            weightTd.textContent = origW;
            repsTd.textContent = origR;
            btn.textContent = 'Edit';
            btn.classList.remove('save');
            btn.dataset.editing = '0';
            cancelBtn.remove();
          });
        }
      });
    });

    body.querySelectorAll('.del-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this set?')) return;
        const tr = btn.closest('tr');
        try {
          await fetch(`/api/sets/${tr.dataset.id}`, { method: 'DELETE' });
          if (typeof renderMuscle === 'function') renderMuscle();
          showDaySets(exercise, dayKey);
        } catch (e) { alert('Delete failed: ' + e.message); }
      });
    });
  } catch (e) {
    body.innerHTML = `<div class="anomaly-empty">Error: ${escapeHtml(e.message)}</div>`;
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
  } else if (tabId === 'program') {
    renderProgramTab();
  }
}

/* ════════════════════════════════════════════════════
   TAB: Program Building
   ════════════════════════════════════════════════════ */

let currentProgramId = null;
let programChart = null;

async function renderProgramTab() {
  const res = await fetchJSON('/api/programs');
  const list = document.getElementById('program-list-items');
  list.innerHTML = res.map(p =>
    `<div class="program-list-item ${p.id === currentProgramId ? 'active' : ''}" data-id="${p.id}">${escapeHtml(p.name)} (${p.weeks}w)</div>`
  ).join('');

  list.querySelectorAll('.program-list-item').forEach(el => {
    el.addEventListener('click', () => {
      currentProgramId = parseInt(el.dataset.id);
      loadProgram(currentProgramId);
      renderProgramTab();
    });
  });

  if (currentProgramId) loadProgram(currentProgramId);
  else {
    document.getElementById('program-editor').style.display = 'none';
    document.getElementById('program-simulation').style.display = 'none';
    document.getElementById('program-empty').style.display = 'block';
  }
}

async function loadProgram(id) {
  const p = await fetchJSON('/api/programs/' + id);
  if (!p) return;
  document.getElementById('program-empty').style.display = 'none';
  document.getElementById('program-editor').style.display = 'block';
  document.getElementById('program-name').value = p.name;
  document.getElementById('program-weeks').value = p.weeks;
  document.getElementById('program-days-per-week').value = p.days_per_week || p.days.length;

  const container = document.getElementById('program-days-container');
  container.innerHTML = p.days.map((d, idx) => `
    <div class="program-day-card" data-day-id="${d.id}">
      <div class="program-day-header">
        <input type="text" class="program-day-name" value="${escapeHtml(d.name || ('Day ' + (idx + 1)))}" placeholder="Day ${idx + 1}">
        <button class="btn-secondary small danger del-day-btn" style="margin-left:auto">×</button>
      </div>
      <table class="program-ex-table">
        <thead><tr><th>Exercise</th><th>Sets</th><th>Min Reps</th><th>Max Reps</th><th>Increment</th><th>RIR</th><th>Start</th><th>End</th><th></th></tr></thead>
        <tbody>
          ${d.exercises.map(ex => `
            <tr data-ex-id="${ex.id}">
              <td><input type="text" class="prog-ex-name" value="${escapeHtml(ex.exercise_name)}"></td>
              <td><input type="number" class="prog-ex-sets" value="${ex.sets}" min="1" max="20" style="width:50px"></td>
              <td><input type="number" class="prog-ex-minreps" value="${ex.min_reps}" min="1" max="30" style="width:50px"></td>
              <td><input type="number" class="prog-ex-maxreps" value="${ex.max_reps}" min="1" max="30" style="width:50px"></td>
              <td><input type="number" class="prog-ex-inc" value="${ex.min_increment}" min="0.5" max="25" step="0.5" style="width:60px"></td>
              <td><input type="number" class="prog-ex-rir" value="${ex.rir}" min="0" max="5" style="width:50px"></td>
              <td><span class="prog-ex-start">—</span></td>
              <td><span class="prog-ex-end">—</span></td>
              <td><button class="btn-secondary small danger del-ex-btn">×</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="prog-add-ex-row">
        <input type="text" class="prog-new-ex-name" placeholder="Exercise name..." list="exercise-datalist">
        <input type="number" class="prog-new-ex-sets" value="3" min="1" max="20" style="width:50px" title="Sets">
        <input type="number" class="prog-new-ex-minreps" value="8" min="1" max="30" style="width:50px" title="Min reps">
        <input type="number" class="prog-new-ex-maxreps" value="12" min="1" max="30" style="width:50px" title="Max reps">
        <input type="number" class="prog-new-ex-inc" value="2.5" min="0.5" max="25" step="0.5" style="width:60px" title="Min increment">
        <input type="number" class="prog-new-ex-rir" value="2" min="0" max="5" style="width:50px" title="RIR">
        <button class="btn-primary small add-ex-btn">Add</button>
      </div>
    </div>
  `).join('');

  // Wire day name changes
  container.querySelectorAll('.program-day-name').forEach(inp => {
    inp.addEventListener('change', async () => {
      const card = inp.closest('.program-day-card');
      await fetchJSON('/api/program-days/' + card.dataset.dayId, { method: 'PUT', body: JSON.stringify({ name: inp.value }) });
    });
  });

  // Wire del day buttons
  container.querySelectorAll('.del-day-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this day and all its exercises?')) return;
      const card = btn.closest('.program-day-card');
      await fetch('/api/program-days/' + card.dataset.dayId, { method: 'DELETE' });
      loadProgram(currentProgramId);
    });
  });

  // Wire exercise delete buttons
  container.querySelectorAll('.del-ex-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr = btn.closest('tr');
      await fetch('/api/program-exercises/' + tr.dataset.exId, { method: 'DELETE' });
      loadProgram(currentProgramId);
    });
  });

  // Wire add exercise buttons
  container.querySelectorAll('.add-ex-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.prog-add-ex-row');
      const dayCard = btn.closest('.program-day-card');
      const name = row.querySelector('.prog-new-ex-name').value.trim();
      if (!name) return;
      const sets = parseInt(row.querySelector('.prog-new-ex-sets').value) || 3;
      const minReps = parseInt(row.querySelector('.prog-new-ex-minreps').value) || 8;
      const maxReps = parseInt(row.querySelector('.prog-new-ex-maxreps').value) || 12;
      const inc = parseFloat(row.querySelector('.prog-new-ex-inc').value) || 2.5;
      const rir = parseInt(row.querySelector('.prog-new-ex-rir').value) || 2;
      await fetch('/api/program-days/' + dayCard.dataset.dayId + '/exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercise_name: name, sets, min_reps: minReps, max_reps: maxReps, min_increment: inc, rir })
      });
      loadProgram(currentProgramId);
    });
  });

  // Wire exercise field changes (auto-save on blur)
  container.querySelectorAll('.prog-ex-name, .prog-ex-sets, .prog-ex-minreps, .prog-ex-maxreps, .prog-ex-inc, .prog-ex-rir').forEach(inp => {
    inp.addEventListener('change', async () => {
      const tr = inp.closest('tr');
      const fields = {
        exercise_name: tr.querySelector('.prog-ex-name').value,
        sets: parseInt(tr.querySelector('.prog-ex-sets').value),
        min_reps: parseInt(tr.querySelector('.prog-ex-minreps').value),
        max_reps: parseInt(tr.querySelector('.prog-ex-maxreps').value),
        min_increment: parseFloat(tr.querySelector('.prog-ex-inc').value),
        rir: parseInt(tr.querySelector('.prog-ex-rir').value)
      };
      await fetch('/api/program-exercises/' + tr.dataset.exId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });
    });
  });

  loadProgramSimulation(id);
}

function loadProgramSimulation(id) {
  const weeks = parseInt(document.getElementById('program-weeks').value) || 4;
  fetchJSON('/api/programs/' + id + '/simulate?weeks=' + weeks).then(data => {
    if (!data || !data.weeks) return;
    document.getElementById('program-simulation').style.display = 'block';
    showSimulation(data);
  }).catch(() => {});
}

async function showSimulation(data) {
  const tableDiv = document.getElementById('program-sim-table');

  // Build chart data
  const labels = [];
  const tssVals = [];
  const ctlVals = [];
  const atlVals = [];
  const tsbVals = [];

  for (const week of data.weeks) {
    for (const day of week.days) {
      const label = `W${week.week} D${day.day}`;
      labels.push(label);
      tssVals.push(day.tss);
      ctlVals.push(day.ctl);
      atlVals.push(day.atl);
      tsbVals.push(day.tsb);
    }
  }

  if (window.programChart) window.programChart.destroy();

  const params = await fetchJSON('/api/params');
  const overtrainTh = params.overtrain_threshold || -20;
  const statusColors = tsbVals.map((tsb, i) => trainingStatus(tsb, ctlVals[i], 20, overtrainTh).cls);

  window.programChart = new Chart(document.getElementById('programSimChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'TSS', data: tssVals, type: 'bar', backgroundColor: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.5)', borderWidth: 0, order: 0, barPercentage: 0.3, categoryPercentage: 0.8 },
        { label: 'Fitness (CTL)', data: ctlVals, borderColor: '#3fb950', backgroundColor: 'transparent', pointRadius: 2, tension: 0.3, order: 1 },
        { label: 'Fatigue (ATL)', data: atlVals, borderColor: '#f85149', backgroundColor: 'transparent', pointRadius: 2, tension: 0.3, order: 1 },
        { label: 'Zero', data: Array(labels.length).fill(0), borderColor: 'rgba(201,209,217,0.5)', tension: 0, pointRadius: 0, pointHitRadius: 0, pointHoverRadius: 0, order: 1 },
        { label: 'TSB', data: tsbVals, borderColor: '#58a6ff', backgroundColor: 'transparent', pointRadius: 2, tension: 0.3, order: 1 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { bottom: 60, right: 70 } },
      plugins: {
        fatigueZones: { statusColors },
        legend: {
          labels: { color: '#c9d1d9', filter: function(item) { return item.text !== 'Zero'; } }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          filter: function(item) { return item.datasetIndex !== 3; }
        }
      },
      interaction: {
        mode: 'index',
        intersect: false
      },
      scales: {
        x: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } }
      }
    }
  });

  buildLegend('program-sim-legend', 20, overtrainTh);

  // Week-by-week schedule with day cards
  let tableHtml = '<div class="chart-container"><h2>Program Details</h2>';
  for (const week of data.weeks) {
    tableHtml += `<div style="margin-bottom:16px"><h3 style="color:#58a6ff;margin-bottom:8px;font-size:0.9rem">Week ${week.week}</h3><div style="display:flex;flex-wrap:wrap;gap:12px">`;
    for (const day of week.days) {
      const isDayDeload = day._da && day.exercises && day.exercises.length > 0;
      const dayHeader = `W${week.week} - D${day.day} - ${escapeHtml(day.day_name)}` + (isDayDeload ? ' (Deload)' : '');
      const boxClass = isDayDeload ? 'program-day-box deload' : 'program-day-box';
      const rowClass = isDayDeload ? 'deload-row' : '';
      tableHtml += `<div class="${boxClass}"><div class="program-day-box-header">${dayHeader}</div>`;
      if (day.exercises && day.exercises.length > 0) {
        tableHtml += `<table class="program-sim-day-table"><thead><tr><th>Exercise</th><th>Weight</th><th>Reps</th><th>Sets</th></tr></thead><tbody>`;
        for (const ex of day.exercises) {
          tableHtml += `<tr class="${rowClass}"><td>${escapeHtml(ex.name)}</td><td>${ex.weight} kg</td><td>${ex.reps}</td><td>${ex.sets}</td></tr>`;
        }
        tableHtml += `</tbody></table>`;
      } else {
        tableHtml += `<div style="padding:8px;color:#8b949e;font-size:0.8rem;text-align:center">Rest day</div>`;
      }
      tableHtml += `</div>`;
    }
    tableHtml += '</div></div>';
  }
  tableHtml += '</div>';

  tableDiv.innerHTML = tableHtml;

  // Populate start/end weight cells from exercise_summary
  if (data.exercise_summary) {
    for (const [name, w] of Object.entries(data.exercise_summary)) {
      const inputs = document.querySelectorAll('.prog-ex-name');
      for (const inp of inputs) {
        if (inp.value === name) {
          const tr = inp.closest('tr');
          tr.querySelector('.prog-ex-start').textContent = w.start_weight + ' kg';
          tr.querySelector('.prog-ex-end').textContent = w.end_weight + ' kg';
          break;
        }
      }
    }
  }

  document.getElementById('program-simulation').style.display = 'block';
  document.getElementById('program-calendar-export').style.display = 'block';

  // Set default start date to tomorrow
  const dateInput = document.getElementById('program-ical-date');
  if (!dateInput.value) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    dateInput.value = tomorrow.toISOString().slice(0, 10);
  }
}

function cssId(str) {
  return str.replace(/[^a-z0-9]/gi, '_');
}

/* ════════════════════════════════════════════════════
   TAB: Settings
   ════════════════════════════════════════════════════ */

const PARAM_DEFS = [
  { key: 'fitness_window_days', label: 'Fitness Window (days)',            desc: 'Days for long-term fitness SMA.',            group: 'Neural Fatigue (TSS)', min: 14, max: 112, step: 1 },
  { key: 'fatigue_window_days', label: 'Fatigue Window (days)',            desc: 'Days for short-term fatigue SMA.',           group: 'Neural Fatigue (TSS)', min: 3, max: 28, step: 1 },
  { key: 'rir_threshold',       label: 'RIR Threshold (%)',                desc: 'Max RIR as % of reps done.',                  group: 'Muscle Dynamics',     min: 0, max: 0.5, step: 0.05, default: 0.3, pct: true },
  { key: 'effective_window_days', label: 'Effective Window (days)',        desc: 'Days of effective sets to sum for growth.',  group: 'Muscle Dynamics',     min: 1, max: 10, step: 1 },
  { key: 'growth_per_set',      label: 'Growth per Set',                   desc: 'PR growth per effective set.',               group: 'Muscle Dynamics',     min: 0.0001, max: 0.01, step: 0.0001, fmt: '0.0000', default: 0.001, pct: true },
  { key: 'max_growth_per_day',  label: 'Max Growth/Day',                   desc: 'Max PR growth per day.',                     group: 'Muscle Dynamics',     min: 0.0001, max: 0.01, step: 0.0001, fmt: '0.0000', default: 0.003, pct: true },
  { key: 'decay_per_day',       label: 'Decay per Day',                    desc: 'PR decay per rest day.',                     group: 'Muscle Dynamics',     min: 0.0001, max: 0.01, step: 0.0001, fmt: '0.0000', default: 0.001, pct: true },
  { key: 'peak_floor_ratio',    label: 'Peak Floor Ratio',                 desc: 'Fraction of peak PR as minimum floor.',     group: 'Muscle Dynamics',     min: 0.3, max: 0.95, step: 0.01, fmt: '0.00', default: 0.7, pct: true },
  { key: 'decay_protection_days', label: 'Decay Protection (days)',         desc: 'Days without decay after effective session.', group: 'Muscle Dynamics',   min: 0, max: 30, step: 1 },
  { key: 'detrain_threshold',   label: 'Detrain Threshold',                desc: 'TSB % above which = Detrain.',               group: 'Training Zones',     min: 5, max: 100, step: 1 },
  { key: 'overtrain_threshold', label: 'Overtrain Threshold',              desc: 'TSB % below which = Overtrain.',             group: 'Training Zones',     min: -100, max: -5, step: 1 },
  { key: 'bodyweight',          label: 'Bodyweight (kg)',                  desc: 'Used for TSS: rm1² / BW (Epley 1RM).',      group: 'Training Zones', min: 30, max: 200, step: 1 },
];

function buildParamField(def, currentVal) {
  const displayVal = def.pct ? currentVal * 100 : currentVal;
  const displayMin = def.pct ? def.min * 100 : def.min;
  const displayMax = def.pct ? def.max * 100 : def.max;
  const displayStep = def.pct ? def.step * 100 : def.step;
  const decPlaces = displayStep < 1 ? (def.fmt ? def.fmt.split('.')[1].length : 4) : 0;
  const valStr = Number(displayVal).toFixed(decPlaces).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `
    <div class="param-row">
      <div class="param-info">
        <span class="param-label">${def.label}${def.pct ? ' (%)' : ''}</span>
        <span class="param-desc">${def.desc}</span>
      </div>
      <div class="param-controls">
        <input type="range" class="param-slider" data-key="${def.key}"
               min="${displayMin}" max="${displayMax}" step="${displayStep}"
               value="${displayVal}">
        <input type="number" class="param-number" data-key="${def.key}"
               min="${displayMin}" max="${displayMax}" step="${displayStep}"
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
        const step = def && def.pct ? def.step * 100 : (def ? def.step : 1);
        const dp = step < 1 ? (def.fmt ? def.fmt.split('.')[1].length : 4) : 0;
        num.value = Number(slider.value).toFixed(dp).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
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
      const def = PARAM_DEFS.find(d => d.key === s.dataset.key);
      const val = parseFloat(s.value);
      updates[s.dataset.key] = def && def.pct ? val / 100 : val;
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
        `<div class="alert deload">Error: ${escapeHtml(e.message)}</div>`;
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
  const dl = document.getElementById('exercise-datalist');
  if (dl) dl.innerHTML = exercises.map(ex => `<option value="${escapeHtml(ex)}">`).join('');

  const statusMap = new Map();
  let statusFilterVal = '';
  try {
    let statusData = null;
    const cached = sessionStorage.getItem('exercise-status');
    if (cached) {
      try { statusData = JSON.parse(cached); } catch (_) {}
    }
    if (!statusData) {
      statusData = await fetchJSON('/api/exercise-status?reps=8');
      if (statusData) sessionStorage.setItem('exercise-status', JSON.stringify(statusData));
    }
    if (statusData) {
      for (const d of statusData) statusMap.set(d.exercise, d.status);
    }
  } catch (e) {
    console.warn('Failed to load exercise status:', e);
  }

  const input = document.getElementById('exercise-input');
  const suggestions = document.getElementById('exercise-suggestions');

  function filterAndShowSuggestions() {
    const q = input.value.toLowerCase().trim();
    const matches = !q ? exercises : exercises.filter(ex => ex.toLowerCase().includes(q));
    const filtered = statusFilterVal
      ? matches.filter(ex => { const s = statusMap.get(ex); return s === undefined || s === statusFilterVal; })
      : matches;
    suggestions.innerHTML = '';
    if (!filtered.length || q.length === 0 && filtered.length === exercises.length) {
      suggestions.classList.remove('active');
      return;
    }
    for (const ex of filtered) {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = ex;
      item.addEventListener('mousedown', (e) => { e.preventDefault(); selectExercise(ex); });
      suggestions.appendChild(item);
    }
    suggestions.classList.add('active');
  }

  function selectExercise(ex) {
    input.value = ex;
    suggestions.classList.remove('active');
    suggestions.innerHTML = '';
    fetchJSON('/api/last-reps?exercise=' + encodeURIComponent(ex)).then(reps => {
      if (reps) document.getElementById('card-reps').value = reps;
      renderMuscle();
    });
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  input.addEventListener('input', debounce(filterAndShowSuggestions, 150));
  input.addEventListener('focus', filterAndShowSuggestions);
  input.addEventListener('blur', () => setTimeout(() => suggestions.classList.remove('active'), 200));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const active = suggestions.querySelector('.autocomplete-item');
      if (active) { selectExercise(active.textContent); }
    }
  });

  const statusFilter = document.getElementById('exercise-status-filter-select');
  if (statusFilter) {
    statusFilter.addEventListener('change', () => {
      statusFilterVal = statusFilter.value;
      const curStatus = statusMap.get(input.value);
      if (statusFilterVal && curStatus !== undefined && curStatus !== statusFilterVal) {
        input.value = '';
        renderMuscle();
      }
      filterAndShowSuggestions();
    });
  }

  document.getElementById('card-reps').addEventListener('input', renderMuscle);
  document.getElementById('reps-down').addEventListener('click', () => {
    const inp = document.getElementById('card-reps');
    if (parseInt(inp.value) > parseInt(inp.min)) { inp.stepDown(); inp.dispatchEvent(new Event('input')); }
  });
  document.getElementById('reps-up').addEventListener('click', () => {
    const inp = document.getElementById('card-reps');
    if (parseInt(inp.value) < parseInt(inp.max)) { inp.stepUp(); inp.dispatchEvent(new Event('input')); }
  });

  /* Sync 2nd time range selector with 1st */
  document.getElementById('time-range').addEventListener('change', () => {
    document.getElementById('time-range-2').value = document.getElementById('time-range').value;
  });
  document.getElementById('time-range-2').addEventListener('change', () => {
    document.getElementById('time-range').value = document.getElementById('time-range-2').value;
  });

  /* CSV import */
  document.getElementById('csv-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const statusEl = document.getElementById('import-status');
    statusEl.textContent = 'Importing...';
    try {
      const text = await file.text();
      const res = await fetch('/api/import-csv', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text });
      const result = await res.json();
      if (result.error) throw new Error(result.error);
      const parts = [];
      if (result.imported > 0) parts.push(`Imported ${result.imported} new sets`);
      if (result.duplicates > 0) parts.push(`${result.duplicates} duplicates skipped`);
      if (result.skipped.cardio > 0 || result.skipped.zeroReps > 0 || result.skipped.other > 0)
        parts.push(`Skipped ${result.skipped.cardio + result.skipped.zeroReps + result.skipped.other} rows`);
      statusEl.textContent = parts.join(', ');
      if (result.imported > 0) renderTSS();
    } catch (err) {
      statusEl.textContent = 'Error: ' + err.message;
    }
    e.target.value = '';
  });

  /* Anomaly modal */
  const modal = document.getElementById('anomaly-modal');
  const modalBody = document.getElementById('anomaly-body');

  function closeModal() { modal.style.display = 'none'; }

  document.querySelector('.modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  /* Day sets modal close */
  const dsModal = document.getElementById('day-sets-modal');
  dsModal.querySelector('.day-sets-close').addEventListener('click', () => { dsModal.style.display = 'none'; });
  dsModal.addEventListener('click', (e) => { if (e.target === dsModal) dsModal.style.display = 'none'; });

  document.getElementById('check-data-btn').addEventListener('click', async () => {
    modal.style.display = 'flex';
    modalBody.innerHTML = '<div class="anomaly-loading">Checking data...</div>';
    try {
      const anomalies = await fetchJSON('/api/anomalies');
      if (anomalies.length === 0) {
        modalBody.innerHTML = '<div class="anomaly-empty">No anomalies found.</div>';
        return;
      }
      let html = `<table class="anomaly-table"><thead><tr>
        <th>Date</th><th>Exercise</th><th>Weight</th><th>Reps</th><th>1RM</th><th>Issue</th><th>Actions</th>
      </tr></thead><tbody>`;
      for (const a of anomalies) {
        const reasonsStr = a.reasons.map(r => {
          const cls = r.includes('above') || r.includes('extra digit') || r.includes('doubled weight') ? 'anomaly-reason-above' : r.includes('below') ? 'anomaly-reason-below' : '';
          return `<span class="anomaly-reason ${cls}">${r}</span>`;
        }).join(' ');
        html += `<tr data-id="${a.id}" data-weight="${a.weight}" data-reps="${a.reps}">
          <td>${a.day_key}</td>
          <td>${escapeHtml(a.exercise)}</td>
          <td class="cell-weight">${a.weight}</td>
          <td class="cell-reps">${a.reps}</td>
          <td>${a.epley_1rm}</td>
          <td>${reasonsStr}</td>
          <td class="anomaly-actions">
            <button class="anomaly-btn edit-btn">Edit</button>
            <button class="anomaly-btn danger del-btn">Delete</button>
          </td>
        </tr>`;
      }
      html += '</tbody></table>';
      modalBody.innerHTML = html;

      modalBody.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const tr = btn.closest('tr');
          const weightTd = tr.querySelector('.cell-weight');
          const repsTd = tr.querySelector('.cell-reps');
          const origW = tr.dataset.weight;
          const origR = tr.dataset.reps;

          if (btn.dataset.editing === '1') {
            const newW = parseFloat(weightTd.querySelector('input').value);
            const newR = parseInt(repsTd.querySelector('input').value, 10);
            if (isNaN(newW) || isNaN(newR)) return;
            try {
              await fetch(`/api/sets/${tr.dataset.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weight: newW, reps: newR }) });
              tr.dataset.weight = newW;
              tr.dataset.reps = newR;
              weightTd.textContent = newW;
              repsTd.textContent = newR;
            } catch (e) { alert('Save failed: ' + e.message); return; }
            btn.textContent = 'Edit';
            btn.classList.remove('save');
            btn.dataset.editing = '0';
            tr.querySelector('.cancel-btn')?.remove();
          } else {
            weightTd.innerHTML = `<input class="anomaly-edit-input" type="number" step="0.1" value="${origW}">`;
            repsTd.innerHTML = `<input class="anomaly-edit-input" type="number" value="${origR}">`;
            btn.textContent = 'Save';
            btn.classList.add('save');
            btn.dataset.editing = '1';
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'anomaly-btn cancel cancel-btn';
            cancelBtn.textContent = 'Cancel';
            btn.parentNode.insertBefore(cancelBtn, btn.nextSibling);
            cancelBtn.addEventListener('click', () => {
              weightTd.textContent = origW;
              repsTd.textContent = origR;
              btn.textContent = 'Edit';
              btn.classList.remove('save');
              btn.dataset.editing = '0';
              cancelBtn.remove();
            });
          }
        });
      });

      modalBody.querySelectorAll('.del-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this set?')) return;
          const tr = btn.closest('tr');
          try {
            await fetch(`/api/sets/${tr.dataset.id}`, { method: 'DELETE' });
            tr.remove();
            if (modalBody.querySelectorAll('.anomaly-table tbody tr').length === 0) {
              modalBody.innerHTML = '<div class="anomaly-empty">No anomalies found after delete.</div>';
            }
          } catch (e) { alert('Delete failed: ' + e.message); }
        });
      });
    } catch (e) {
      modalBody.innerHTML = `<div class="anomaly-empty">Error: ${e.message}</div>`;
    }
  });

  /* Program top-level buttons */
  const npModal = document.getElementById('new-program-modal');
  document.querySelector('.np-close').addEventListener('click', () => { npModal.style.display = 'none'; });
  npModal.addEventListener('click', (e) => { if (e.target === npModal) npModal.style.display = 'none'; });
  document.getElementById('btn-new-program').addEventListener('click', () => {
    document.getElementById('np-name').value = '';
    document.getElementById('np-dpw').value = '3';
    npModal.style.display = 'flex';
    document.getElementById('np-name').focus();
  });
  document.getElementById('np-create').addEventListener('click', async () => {
    const name = document.getElementById('np-name').value.trim();
    if (!name) return;
    const daysPerWeek = parseInt(document.getElementById('np-dpw').value) || 3;
    npModal.style.display = 'none';
    try {
      const res = await fetchJSON('/api/programs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, weeks: 4, days_per_week: daysPerWeek }) });
      currentProgramId = res.id;
      renderProgramTab();
    } catch (e) {
      alert('Error creating program: ' + e.message);
    }
  });

  document.getElementById('btn-save-program').addEventListener('click', async () => {
    if (!currentProgramId) return;
    const name = document.getElementById('program-name').value.trim();
    const weeks = parseInt(document.getElementById('program-weeks').value) || 4;
    const daysPerWeekEl = document.getElementById('program-days-per-week');
    const daysPerWeek = daysPerWeekEl.value ? parseInt(daysPerWeekEl.value) : null;
    await fetch('/api/programs/' + currentProgramId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, weeks, days_per_week: daysPerWeek })
    });
    renderProgramTab();
  });

  document.getElementById('btn-delete-program').addEventListener('click', async () => {
    if (!currentProgramId || !confirm('Delete this entire program?')) return;
    await fetch('/api/programs/' + currentProgramId, { method: 'DELETE' });
    currentProgramId = null;
    renderProgramTab();
  });

  document.getElementById('btn-add-day').addEventListener('click', async () => {
    if (!currentProgramId) return;
    const p = await fetchJSON('/api/programs/' + currentProgramId);
    const nextDay = (p.days ? p.days.length : 0) + 1;
    await fetch('/api/programs/' + currentProgramId + '/days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day_number: nextDay, name: 'Day ' + nextDay })
    });
    loadProgram(currentProgramId);
  });

  document.getElementById('btn-simulate').addEventListener('click', () => {
    if (currentProgramId) loadProgramSimulation(currentProgramId);
  });

  document.getElementById('btn-export-ical').addEventListener('click', () => {
    if (!currentProgramId) return;
    const weeks = parseInt(document.getElementById('program-weeks').value) || 4;
    const startDate = document.getElementById('program-ical-date').value;
    if (!startDate) { alert('Please select a start date.'); return; }
    window.open(`/api/programs/${currentProgramId}/ical?weeks=${weeks}&start_date=${startDate}`);
  });

  /* Initial render */
  document.getElementById('time-range').value = '30';
  document.getElementById('time-range-2').value = '30';
  renderTSS();
}

document.addEventListener('DOMContentLoaded', init);


