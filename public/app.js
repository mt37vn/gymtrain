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
  let trainingDaysAll = brkQs ? await fetchJSON('/api/training-days' + brkQs) : [];
  document.getElementById('stats-bar').textContent =
    `${stats.totalSets} sets · ${stats.totalDays} days`;

  /* Training status */
  const status = trainingStatus(summary.tsb, summary.ctl, detrainTh, overtrainTh);

  /* Trim first fitness_window_days when "Since start" is active */
  const trimStart = (!tr.days && !tr.from && !tr.to) ? (params.fitness_window_days || 42) : 0;
  if (trimStart > 0 && timeline.length > trimStart) {
    const trimmedKeys = new Set(timeline.slice(trimStart).map(d => d.day_key));
    trainingDaysAll = trainingDaysAll.filter(d => trimmedKeys.has(d.day_key));
  }
  const tl = trimStart > 0 && timeline.length > trimStart ? timeline.slice(trimStart) : timeline;

  const labels = tl.map(d => d.day_key);
  const ctlData = tl.map(d => d.ctl);
  const atlData = tl.map(d => d.atl);
  const tsbData = tl.map(d => d.tsb);
  const tssData = tl.map(d => d.daily_tss);

  /* Summary cards */
  const tsbPct = summary.ctl > 0 ? (summary.tsb / summary.ctl) * 100 : 0;
  let firstFit = 0, lastFit = 0;
  for (let i = 0; i < ctlData.length; i++) {
    if (ctlData[i] > 0) {
      if (firstFit === 0) firstFit = ctlData[i];
      lastFit = ctlData[i];
    }
  }
  const fitChange = firstFit > 0 ? ((lastFit - firstFit) / firstFit) * 100 : 0;
  const fitChangeCls = fitChange > 0 ? 'positive' : fitChange < 0 ? 'negative' : '';
  const statusLabels = { detrain: 'Detrain', deload: 'Deload', productive: 'Productive', overtrain: 'Overtrain' };
  const statusColorsPie = { detrain: '#8b949e', deload: '#58a6ff', productive: '#3fb950', overtrain: '#f85149' };
  const statusCounts = { detrain: 0, deload: 0, productive: 0, overtrain: 0 };
  for (let i = 0; i < tsbData.length; i++) {
    const st = trainingStatus(tsbData[i], ctlData[i], detrainTh, overtrainTh);
    statusCounts[st.cls]++;
  }
  // Sum effective, warmup, and junk sets across the visible timeline
  var totalEff = 0, totalSets = 0, totalWarmup = 0;
  for (var si = 0; si < tl.length; si++) {
    totalSets += tl[si].total_sets || 0;
    totalEff += tl[si].total_effective_sets || 0;
    totalWarmup += tl[si].total_warmup_sets || 0;
  }
  var totalJunk = Math.max(0, totalSets - totalEff - totalWarmup);
  document.getElementById('summary-cards-tss').innerHTML = `
    <div class="card">
      <h3>Training Status</h3>
      <div class="value ${status.cls}">${status.label}</div>
      <div class="hint">${status.desc}</div>
    </div>
    <div class="card"><h3>TSB (% Fitness)</h3><div class="value ${status.cls}">${formatNum(tsbPct, 1)}%</div></div>
    <div class="card"><h3>Fitness (${params.fitness_window_days || 42}d SMA)</h3><div class="value positive">${formatNum(summary.ctl)}</div><div style="font-size:0.7rem;color:#8b949e;margin-top:2px">${fitChange > 0 ? '+' : ''}${formatNum(fitChange, 1)}% <span class="${fitChangeCls}">${fitChangeCls === 'positive' ? '▲' : fitChangeCls === 'negative' ? '▼' : ''}</span></div></div>
    <div class="card"><h3>Fatigue (${params.fatigue_window_days || 7}d SMA)</h3><div class="value negative">${formatNum(summary.atl)}</div></div>
    <div class="card"><h3>TSB</h3><div class="value blue">${formatNum(summary.tsb, 1)}</div></div>
    <div class="card" id="status-pie-card">
      <h3>Training Days Breakdown</h3>
      <canvas id="statusPieChart" class="status-pie-canvas"></canvas>
      <div style="font-size:0.7rem;color:#8b949e;text-align:center;margin-top:4px">
        ${Object.entries(statusCounts).filter(([k,v]) => v > 0).map(([k,v]) =>
          `<span style="display:inline-block;margin:0 4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${statusColorsPie[k]};margin-right:3px"></span>${v}</span>`
        ).join('')}
      </div>
    </div>
    <div class="card" id="junk-pie-card">
      <h3>Eff / Warmup / Junk</h3>
      <canvas id="junkPieChart" class="status-pie-canvas"></canvas>
      <div style="font-size:0.7rem;color:#8b949e;text-align:center;margin-top:4px">
        <span style="display:inline-block;margin:0 4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#3fb950;margin-right:3px"></span>Eff ${totalEff}</span>
        <span style="display:inline-block;margin:0 4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#58a6ff;margin-right:3px"></span>Warm ${totalWarmup}</span>
        <span style="display:inline-block;margin:0 4px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f85149;margin-right:3px"></span>Junk ${totalJunk}</span>
      </div>
    </div>
  `;

  if (chartInstances.statusPie) chartInstances.statusPie.destroy();
  const pieLabels = Object.keys(statusCounts).filter(k => statusCounts[k] > 0);
  const pieDataArr = pieLabels.map(k => statusCounts[k]);
  const pieColorsArr = pieLabels.map(k => statusColorsPie[k]);
  if (pieLabels.length > 0) {
    chartInstances.statusPie = new Chart(document.getElementById('statusPieChart'), {
      type: 'doughnut',
      data: { labels: pieLabels, datasets: [{ data: pieDataArr, backgroundColor: pieColorsArr, borderColor: '#0d1117', borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: true, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ctx.label + ': ' + ctx.parsed + ' days' } }
        },
        cutout: '65%'
      }
    });
  }

  // Junk vs effective sets pie chart
  if (chartInstances.junkPie) chartInstances.junkPie.destroy();
  if (totalSets > 0) {
    var junkLabels = ['Effective', 'Warmup', 'Junk'];
    var junkData = [totalEff, totalWarmup, totalJunk];
    var junkColors = ['#3fb950', '#58a6ff', '#f85149'];
    // Filter out zero-value segments to avoid invisible slices
    var filteredIndices = junkData.map(function(v,i) { return v > 0 ? i : -1; }).filter(function(i) { return i >= 0; });
    var filteredLabels = filteredIndices.map(function(i) { return junkLabels[i]; });
    var filteredData = filteredIndices.map(function(i) { return junkData[i]; });
    var filteredColors = filteredIndices.map(function(i) { return junkColors[i]; });
    chartInstances.junkPie = new Chart(document.getElementById('junkPieChart'), {
      type: 'doughnut',
      data: {
        labels: filteredLabels,
        datasets: [{
          data: filteredData,
          backgroundColor: filteredColors,
          borderColor: '#0d1117',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: true, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ctx.label + ': ' + ctx.parsed + ' sets'
            }
          }
        },
        cutout: '65%'
      }
    });
  }

  destroyCharts(['combined']);

  const statusColors = tsbData.map((tsb, i) => trainingStatus(tsb, ctlData[i], detrainTh, overtrainTh).cls);

  chartInstances.combined = new Chart(document.getElementById('combinedChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'TSS', data: tssData, type: 'bar', backgroundColor: 'rgba(255,255,255,0.5)', borderColor: 'transparent', borderWidth: 0, order: 0, barPercentage: 0.3, categoryPercentage: 0.8 },
        { label: `Fitness (${params.fitness_window_days || 42}d SMA)`, data: ctlData, borderColor: '#3fb950', backgroundColor: 'transparent', pointRadius: 2, tension: 0.3, order: 1 },
        { label: `Fatigue (${params.fatigue_window_days || 7}d SMA)`, data: atlData, borderColor: '#f85149', backgroundColor: 'transparent', pointRadius: 2, tension: 0.3, order: 1 },
        { label: 'Zero', data: Array(labels.length).fill(0), borderColor: 'rgba(201,209,217,0.5)', tension: 0, pointRadius: 0, pointHitRadius: 0, pointHoverRadius: 0, order: 1 },
        { label: 'TSB', data: tsbData, borderColor: '#58a6ff', backgroundColor: 'transparent', pointRadius: 2, tension: 0.3, order: 1 }
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
          filter: function(item) { return item.datasetIndex !== 3; },
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
      scales: {
        x: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' }, beginAtZero: true }
      },
      onClick: function(e) {
        const pts = this.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
        if (pts.length === 0) return;
        const idx = pts[0].index;
        const dayKey = labels[idx];
        if (!dayKey) return;
        const day = (trainingDaysAll || []).find(d => d.day_key === dayKey);
        if (!day) return;
        const header = day.day_key + ' · ' + day.day_name + (day.workout ? ' — ' + escapeHtml(day.workout) : '');
        document.getElementById('tss-detail-title').textContent = header;
        document.getElementById('tss-detail-body').innerHTML = `
          <table class="program-sim-day-table">
            <thead><tr><th>Exercise</th><th>Weight</th><th>Reps</th><th>Sets</th><th>TSS</th></tr></thead>
            <tbody>
              ${day.exercises.map(ex => `<tr>
                <td>${escapeHtml(ex.exercise)}</td>
                <td>${ex.weight} kg</td>
                <td>${ex.reps}</td>
                <td class="num">${ex.sets}</td>
                <td class="num">${formatNum(ex.tss, 1)}</td>
              </tr>`).join('')}
              <tr class="sim-total-row"><td colspan="4"><strong>Total</strong></td><td><strong>${formatNum(day.total_tss, 1)}</strong></td></tr>
            </tbody>
          </table>`;
        document.getElementById('tss-detail-modal').style.display = 'flex';
      }
    }
  });

  buildLegend('legend-tss', detrainTh, overtrainTh);

  /* Exercise summary table */
  const exSummary = document.querySelector('#exercise-summary-table tbody');
  const exSection = document.getElementById('exercise-summary-section');
  if (!trainingDaysAll || trainingDaysAll.length === 0) {
    exSection.style.display = 'none';
  } else {
    exSection.style.display = '';
    const exMap = {};
    for (const day of trainingDaysAll) {
      for (const ex of day.exercises) {
        if (!exMap[ex.exercise]) exMap[ex.exercise] = { first: null, last: null, totalSets: 0 };
        const entry = exMap[ex.exercise];
        entry.totalSets += ex.sets;
        if (!entry.first) entry.first = { day_key: day.day_key, weight: ex.weight };
        entry.last = { day_key: day.day_key, weight: ex.weight };
      }
    }
    let exData = Object.keys(exMap).map(name => {
      const e = exMap[name];
      const change = e.first.weight > 0 ? ((e.last.weight - e.first.weight) / e.first.weight * 100) : 0;
      return { name, totalSets: e.totalSets, startWeight: e.first.weight, endWeight: e.last.weight, change };
    });

    let sortKey = 'totalSets';
    let sortDir = -1;

    function renderExSummary() {
      const sorted = [...exData].sort((a, b) => {
        let va = a[sortKey], vb = b[sortKey];
        if (typeof va === 'string') va = va.toLowerCase();
        if (typeof vb === 'string') vb = vb.toLowerCase();
        return va < vb ? -sortDir : va > vb ? sortDir : 0;
      });
      const arrow = d => sortKey === d ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
      document.querySelectorAll('#exercise-summary-table thead th').forEach(th => {
        const key = th.dataset.sort;
        th.textContent = key ? ({ exercise: 'Exercise', totalSets: 'Total Sets', startWeight: 'Start Weight', endWeight: 'End Weight', change: 'Change' }[key] || key) + (key === sortKey ? (sortDir === 1 ? ' ▲' : ' ▼') : '') : th.textContent;
      });
      exSummary.innerHTML = sorted.map(e => {
        const cls = e.change > 0 ? 'pos' : e.change < 0 ? 'neg' : '';
        return `<tr>
          <td>${escapeHtml(e.name)}</td>
          <td class="num">${e.totalSets}</td>
          <td class="num">${formatNum(e.startWeight, 1)}</td>
          <td class="num">${formatNum(e.endWeight, 1)}</td>
          <td class="num ${cls}">${e.change > 0 ? '+' : ''}${formatNum(e.change, 1)}%</td>
        </tr>`;
      }).join('');
    }

    renderExSummary();

    document.querySelectorAll('#exercise-summary-table thead th[data-sort]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (sortKey === key) sortDir *= -1;
        else { sortKey = key; sortDir = key === 'name' ? 1 : -1; }
        renderExSummary();
      });
    });
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
      const growthCls = growthPct > 0 ? 'pos' : '';
      const effSets = d.anabolism || 0;
      rows += `<tr>
        <td>${d.day_key}</td>
        <td class="num">${d.total_sets}</td>
        <td class="num">${effSets}</td>
        <td class="num ${growthCls}">${formatNum(growthPct, 2)}%</td>
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
  } else if (tabId === 'program') {
    renderProgramTab();
  } else if (tabId === 'muscle') {
    renderMuscle();
  } else if (tabId === 'settings') {
    renderSettings();
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
  // ── Mode switch ──
  const modeBtns = document.querySelectorAll('.mode-switch-btn');
  const cycleDays = () => p.days.length;
  const updateModeUI = () => {
    modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === p.schedule_mode));
    document.getElementById('program-mode-label').textContent = p.schedule_mode === 'cycle'
      ? 'Cycle mode — ' + cycleDays() + '/7 days'
      : 'Week mode — 7 fixed days (Mon-Sun)';
    const addBtn = document.getElementById('btn-add-day');
    addBtn.style.display = (p.schedule_mode === 'cycle' && cycleDays() < 7) ? '' : 'none';
  };
  updateModeUI();
  modeBtns.forEach(btn => {
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    newBtn.addEventListener('click', async () => {
      const newMode = newBtn.dataset.mode;
      if (newMode === p.schedule_mode) return;
      if (newMode === 'week' && p.days.length < 7) {
        for (let i = p.days.length; i < 7; i++) {
          await fetch('/api/programs/' + id + '/days', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ day_number: i + 1 })
          });
        }
      }
      if (newMode === 'week' && p.days.length > 7) {
        for (const d of p.days.slice(7)) {
          await fetch('/api/program-days/' + d.id, { method: 'DELETE' });
        }
      }
      await fetch('/api/programs/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule_mode: newMode })
      });
      loadProgram(id);
    });
  });

  const dayNameForPos = (idx) => p.schedule_mode === 'week'
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][idx] || 'Day ' + (idx + 1)
    : 'Day ' + (idx + 1);

  const container = document.getElementById('program-days-container');
  container.innerHTML = p.days.map((d, idx) => `
    <div class="program-day-card" draggable="true" data-day-id="${d.id}">
      <div class="program-day-header">
        <span class="drag-handle">⠿</span>
        <strong class="program-day-name">${dayNameForPos(idx)}</strong>
        <button class="btn-secondary small copy-day-btn" data-day-id="${d.id}" style="margin-left:auto">Copy</button>
        ${p.schedule_mode === 'cycle' ? '<button class="btn-secondary small danger del-day-btn" style="margin-left:4px">×</button>' : ''}
      </div>
      <div class="copy-day-picker" id="copy-picker-${d.id}" style="display:none"></div>
      <table class="program-ex-table">
        <thead><tr><th style="width:20px"></th><th>Exercise</th><th>Sets</th><th>Min Reps</th><th>Max Reps</th><th>Increment</th><th>Start</th><th>End</th><th>%Change</th><th></th></tr></thead>
        <tbody data-day-id="${d.id}">
          ${d.exercises.map(ex => `
            <tr data-ex-id="${ex.id}" draggable="true">
              <td class="drag-handle">⠿</td>
              <td><input type="text" class="prog-ex-name" value="${escapeHtml(ex.exercise_name)}"></td>
              <td><input type="number" class="prog-ex-sets" value="${ex.sets}" min="1" max="20" style="width:50px"></td>
              <td><input type="number" class="prog-ex-minreps" value="${ex.min_reps}" min="1" max="50" style="width:50px"></td>
              <td><span class="prog-ex-maxreps">—</span></td>
              <td>
                <input type="number" class="prog-ex-inc" value="${ex.use_lb_inc ? (ex.min_increment * 2.20462).toFixed(1) : ex.min_increment.toFixed(1)}"
                  min="${ex.use_lb_inc ? 5 : 0.5}" max="${ex.use_lb_inc ? 110 : 25}" step="${ex.use_lb_inc ? '5' : '0.5'}" style="width:60px">
                <button class="inc-unit-toggle" data-unit="${ex.use_lb_inc ? 'lb' : 'kg'}">${ex.use_lb_inc ? 'lb' : 'kg'}</button>
                <span class="inc-eq">${ex.use_lb_inc ? '≈ ' + ex.min_increment.toFixed(1) + ' kg' : ''}</span>
              </td>
              <td><span class="prog-ex-start">—</span></td>
              <td><span class="prog-ex-end">—</span></td>
              <td><span class="prog-ex-change">—</span></td>
              <td><button class="btn-secondary small danger del-ex-btn">×</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="prog-add-ex-row">
        <input type="text" class="prog-new-ex-name" placeholder="Exercise name..." list="exercise-datalist">
        <input type="number" class="prog-new-ex-sets" value="3" min="1" max="20" style="width:50px" title="Sets">
        <input type="number" class="prog-new-ex-minreps" value="8" min="1" max="50" style="width:50px" title="Min reps">
        <input type="number" class="prog-new-ex-inc" value="2.5" min="0.5" max="25" step="0.5" style="width:60px" title="Min increment">
        <button class="inc-unit-toggle" data-unit="kg">kg</button>
        <span class="inc-eq"></span>
        <button class="btn-primary small add-ex-btn">Add</button>
      </div>
    </div>
  `).join('');

  // Wire day name changes
  // Wire inc-unit-toggle buttons (kg ↔ lb)
  container.querySelectorAll('.inc-unit-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const td = btn.closest('td');
      const addRow = btn.closest('.prog-add-ex-row');
      const isAddRow = !!addRow;
      const inc = isAddRow ? addRow.querySelector('.prog-new-ex-inc') : td.querySelector('.prog-ex-inc');
      const eq = isAddRow ? addRow.querySelector('.inc-eq') : td.querySelector('.inc-eq');
      const curUnit = btn.dataset.unit;
      const val = parseFloat(inc.value) || 0;

      if (curUnit === 'kg') {
        // Switch to lb
        inc.value = (val * 2.20462).toFixed(1);
        inc.min = 5; inc.max = 110; inc.step = 5;
        btn.dataset.unit = 'lb'; btn.textContent = 'lb';
        eq.textContent = '≈ ' + (val).toFixed(1) + ' kg';
      } else {
        // Switch to kg
        inc.value = (val / 2.20462).toFixed(1);
        inc.min = 0.5; inc.max = 25; inc.step = 0.5;
        btn.dataset.unit = 'kg'; btn.textContent = 'kg';
        eq.textContent = '';
      }
      inc.dispatchEvent(new Event('change', { bubbles: true }));
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

  // Wire copy day buttons
  container.querySelectorAll('.copy-day-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const srcId = parseInt(btn.dataset.dayId);
      const picker = document.getElementById('copy-picker-' + srcId);
      const isVisible = picker.style.display !== 'none';
      // Hide all pickers first
      document.querySelectorAll('.copy-day-picker').forEach(el => el.style.display = 'none');
      if (isVisible) return;
      // Build picker: select target + copy button
      const otherDays = p.days.filter(d => d.id !== srcId);
      if (otherDays.length === 0) {
        picker.innerHTML = '<span style="color:#8b949e;font-size:0.75rem">No other days to copy to</span>';
      } else {
        picker.innerHTML = '<span style="color:#8b949e;font-size:0.75rem">Copy exercises to:</span> ' +
          '<select id="copy-target-' + srcId + '">' +
          otherDays.map(d => '<option value="' + d.id + '">' + escapeHtml(d.name || 'Day ' + d.id) + '</option>').join('') +
          '</select> ' +
          '<button class="btn-primary small do-copy-btn" data-src="' + srcId + '">Copy</button>' +
          ' <span class="copy-status" style="font-size:0.75rem;color:#8b949e"></span>';
        picker.querySelector('.do-copy-btn').addEventListener('click', async () => {
          const targetId = parseInt(document.getElementById('copy-target-' + srcId).value);
          const statusEl = picker.querySelector('.copy-status');
          statusEl.textContent = 'Copying...';
          try {
            await fetch('/api/program-days/' + srcId + '/copy-to/' + targetId, { method: 'POST' });
            statusEl.textContent = '\u2713 Copied';
            setTimeout(() => loadProgram(currentProgramId), 500);
          } catch (e) {
            statusEl.textContent = 'Error: ' + e.message;
          }
        });
      }
      picker.style.display = 'block';
    });
  });

  // Wire day card drag-and-drop reorder
  let draggedDayId = null;
  container.querySelectorAll('.program-day-card[draggable]').forEach(card => {
    card.addEventListener('dragstart', () => {
      draggedDayId = card.dataset.dayId;
      card.classList.add('dragging');
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (!draggedDayId || draggedDayId === card.dataset.dayId) return;
      const parent = card.parentNode;
      const draggedCard = parent.querySelector(`.program-day-card[data-day-id="${draggedDayId}"]`);
      if (!draggedCard) return;
      const rect = card.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      if (after) {
        parent.insertBefore(draggedCard, card.nextSibling);
      } else {
        parent.insertBefore(draggedCard, card);
      }
      draggedDayId = null;
      const ids = [...parent.querySelectorAll('.program-day-card[draggable]')].map(c => parseInt(c.dataset.dayId));
      await fetch('/api/programs/' + currentProgramId + '/reorder-days', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayIds: ids })
      });
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      draggedDayId = null;
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

  // Wire drag-and-drop reorder (within day + cross-day move)
  let draggedId = null;
  let draggedExDayId = null;

  // Helper: move exercise row to target tbody at specified position
  async function doMoveExRow(draggedRow, targetTbody, insertBeforeRow, sourceExDayId) {
    if (insertBeforeRow) {
      targetTbody.insertBefore(draggedRow, insertBeforeRow);
    } else {
      targetTbody.appendChild(draggedRow);
    }

    if (targetTbody.dataset.dayId === sourceExDayId) {
      // Same-day reorder
      const ids = [...targetTbody.querySelectorAll('tr[draggable]')].map(r => parseInt(r.dataset.exId));
      await fetch('/api/program-days/' + targetTbody.dataset.dayId + '/reorder-exercises', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseIds: ids })
      });
    } else {
      // Cross-day move: update day_id then reorder both days
      const exId = parseInt(draggedRow.dataset.exId);
      await fetch('/api/program-exercises/' + exId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ day_id: parseInt(targetTbody.dataset.dayId) })
      });
      const targetIds = [...targetTbody.querySelectorAll('tr[draggable]')].map(r => parseInt(r.dataset.exId));
      await fetch('/api/program-days/' + targetTbody.dataset.dayId + '/reorder-exercises', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exerciseIds: targetIds })
      });
      const sourceTbody = document.querySelector(`tbody[data-day-id="${sourceExDayId}"]`);
      if (sourceTbody) {
        const sourceIds = [...sourceTbody.querySelectorAll('tr[draggable]')].map(r => parseInt(r.dataset.exId));
        await fetch('/api/program-days/' + sourceExDayId + '/reorder-exercises', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exerciseIds: sourceIds })
        });
      }
    }
  }

  // Row-level drag events
  container.querySelectorAll('.program-ex-table tbody tr[draggable]').forEach(tr => {
    tr.addEventListener('dragstart', () => {
      draggedId = tr.dataset.exId;
      draggedExDayId = tr.closest('tbody').dataset.dayId;
      tr.classList.add('dragging');
    });
    tr.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      tr.classList.add('drag-over');
    });
    tr.addEventListener('dragleave', () => {
      tr.classList.remove('drag-over');
    });
    tr.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      tr.classList.remove('drag-over');
      if (!draggedId || draggedId === tr.dataset.exId) return;
      const targetTbody = tr.closest('tbody');
      const draggedRow = document.querySelector(`tr[data-ex-id="${draggedId}"]`);
      if (!draggedRow) { draggedId = null; return; }

      const rect = tr.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      var srcDay = draggedExDayId;
      await doMoveExRow(draggedRow, targetTbody, after ? tr.nextElementSibling : tr, srcDay);
      draggedId = null;
    });
    tr.addEventListener('dragend', () => {
      tr.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      draggedId = null;
      draggedExDayId = null;
    });
  });

  // Tbody-level drag events (for empty days / gaps between rows)
  container.querySelectorAll('.program-ex-table tbody').forEach(tbody => {
    tbody.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    tbody.addEventListener('drop', async (e) => {
      if (!draggedId) return;
      // Only handle if the drop didn't hit a specific row (which has stopPropagation)
      if (e.target.closest('tr[draggable]')) return;
      e.preventDefault();
      const draggedRow = document.querySelector(`tr[data-ex-id="${draggedId}"]`);
      if (!draggedRow) { draggedId = null; return; }
      var srcDay = draggedExDayId;
      await doMoveExRow(draggedRow, e.target.closest('tbody') || e.currentTarget, null, srcDay);
      draggedId = null;
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
      const isLb = row.querySelector('.inc-unit-toggle').dataset.unit === 'lb';
      let inc = parseFloat(row.querySelector('.prog-new-ex-inc').value) || 2.5;
      if (isLb) inc = inc / 2.20462;
      await fetch('/api/program-days/' + dayCard.dataset.dayId + '/exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exercise_name: name, sets, min_reps: minReps, min_increment: inc, use_lb_inc: isLb ? 1 : 0 })
      });
      loadProgram(currentProgramId);
    });
  });

  // Wire exercise field changes (auto-save on blur)
  container.querySelectorAll('.prog-ex-name, .prog-ex-sets, .prog-ex-minreps, .prog-ex-inc').forEach(inp => {
    inp.addEventListener('change', async () => {
      const tr = inp.closest('tr');
      const toggle = tr.querySelector('.inc-unit-toggle');
      const isLb = toggle ? toggle.dataset.unit === 'lb' : false;
      let inc = parseFloat(tr.querySelector('.prog-ex-inc').value) || 0;
      if (isLb) inc = inc / 2.20462;
      const fields = {
        exercise_name: tr.querySelector('.prog-ex-name').value,
        sets: parseInt(tr.querySelector('.prog-ex-sets').value),
        min_reps: parseInt(tr.querySelector('.prog-ex-minreps').value),
        min_increment: inc,
        use_lb_inc: isLb ? 1 : 0
      };
      await fetch('/api/program-exercises/' + tr.dataset.exId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields)
      });
    });
  });

  // Live-update max reps when min_reps or increment change
  container.querySelectorAll('.prog-ex-minreps, .prog-ex-inc').forEach(inp => {
    inp.addEventListener('input', () => {
      const tr = inp.closest('tr');
      const startW = parseFloat(tr.dataset.startWeight);
      if (!startW || startW <= 0) return;
      const minR = parseInt(tr.querySelector('.prog-ex-minreps').value) || 0;
      const inc = parseFloat(tr.querySelector('.prog-ex-inc').value) || 0;
      const maxReps = inc > 0 && minR > 0
        ? Math.floor(30 * ((startW + inc) / startW * (1 + minR / 30) - 1))
        : 0;
      tr.querySelector('.prog-ex-maxreps').textContent = maxReps || '—';
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

var _simData = null;
async function showSimulation(data) {
  _simData = data;
  const tableDiv = document.getElementById('program-sim-table');

  // Build chart data
  const labels = [];
  const tssVals = [];
  const ctlVals = [];
  const atlVals = [];
  const tsbVals = [];

  for (const week of data.weeks) {
    for (const day of week.days) {
      const label = day.schedule_mode === 'cycle' ? `W${week.week} D${day.schedule_pos || day.day}` : `W${week.week} D${day.day}`;
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
  const lastExWeight = {};
  const lastExReps = {};
  for (const week of data.weeks) {
    tableHtml += `<div style="margin-bottom:16px"><h3 style="color:#58a6ff;margin-bottom:8px;font-size:0.9rem">Week ${week.week}</h3><div class="program-week-grid">`;
    for (const day of week.days) {
      const isDayDeload = day.is_deload && day.exercises && day.exercises.length > 0;
      const dayNum = day.schedule_mode === 'cycle' ? (day.schedule_pos || day.day) : day.day;
      const dayHeader = `W${week.week} - D${dayNum} - ${escapeHtml(day.day_name)}` + (isDayDeload ? ' (Deload)' : '');
      const boxClass = isDayDeload ? 'program-day-box deload' : 'program-day-box';
      const rowClass = isDayDeload ? 'deload-row' : '';
      tableHtml += `<div class="${boxClass}"><div class="program-day-box-header">${dayHeader}</div>`;
      if (day.exercises && day.exercises.length > 0) {
        tableHtml += `<table class="program-sim-day-table"><thead><tr><th>Exercise</th><th>Weight</th><th>Reps</th><th>Sets</th><th>TSS</th></tr></thead><tbody>`;
        for (const ex of day.exercises) {
          const prevW = lastExWeight[ex.name];
          const prevR = lastExReps[ex.name];
          const wCls = prevW !== undefined && ex.weight > prevW ? ' class="weight-up"' : '';
          const rCls = prevR !== undefined && ex.reps > prevR ? ' class="weight-up"' : '';
          if (!day.is_deload) {
            lastExWeight[ex.name] = ex.weight;
            lastExReps[ex.name] = ex.reps;
          }
          tableHtml += `<tr class="${rowClass}"><td>${escapeHtml(ex.name)}</td><td${wCls}>${ex.weight} kg${ex.plates && ex.use_lb_inc ? '<br>(' + escapeHtml(ex.plates) + ')' : ''}</td><td${rCls}>${ex.reps}</td><td>${ex.sets}</td>`;
          tableHtml += `<td>${ex.tss !== undefined ? ex.tss : '—'}</td></tr>`;
        }
        tableHtml += `<tr class="sim-total-row"><td colspan="4"><strong>Total</strong></td><td><strong>${day.tss}</strong></td></tr>`;
        tableHtml += `</tbody></table>`;
      } else {
        tableHtml += `<div class="rest-day-label" style="color:#8b949e;text-align:center">Rest day</div>`;
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
          // Store start weight for live max-reps recalculation
          tr.dataset.startWeight = w.start_weight;
          // Compute max reps threshold from start weight, min reps, and increment
          const minR = parseInt(tr.querySelector('.prog-ex-minreps').value) || 0;
          const inc = parseFloat(tr.querySelector('.prog-ex-inc').value) || 0;
          const maxReps = w.start_weight > 0 && inc > 0 && minR > 0
            ? Math.floor(30 * ((w.start_weight + inc) / w.start_weight * (1 + minR / 30) - 1))
            : 0;
          tr.querySelector('.prog-ex-maxreps').textContent = maxReps || '—';
          const pct = ((w.end_weight - w.start_weight) / w.start_weight * 100).toFixed(1);
          const changeEl = tr.querySelector('.prog-ex-change');
          changeEl.textContent = (w.end_weight >= w.start_weight ? '+' : '') + pct + '%';
          changeEl.className = 'prog-ex-change' + (w.end_weight > w.start_weight ? ' weight-up' : w.end_weight < w.start_weight ? ' weight-down' : '');
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
  // Populate exercise selector from simulation data
  var exSelect = document.getElementById('program-ex-select');
  var exChartContainer = document.getElementById('program-ex-chart-container');
  var prBarDiv = document.getElementById('program-pr-bar');
  exSelect.innerHTML = '<option value="">Select exercise...</option>';
  var exSet = {};
  for (var wi = 0; wi < data.weeks.length; wi++) {
    var week = data.weeks[wi];
    for (var di = 0; di < (week.days || []).length; di++) {
      var day = week.days[di];
      for (var ei = 0; ei < (day.exercises || []).length; ei++) {
        var ex = day.exercises[ei];
        exSet[ex.name] = true;
      }
    }
  }
  var exNames = Object.keys(exSet).sort();
  if (exNames.length > 0) {
    exChartContainer.style.display = '';
    for (var ni = 0; ni < exNames.length; ni++) {
      exSelect.innerHTML += '<option value="' + exNames[ni] + '">' + exNames[ni] + '</option>';
    }
    if (chartInstances.programEx) { chartInstances.programEx.destroy(); chartInstances.programEx = null; }
    prBarDiv.innerHTML = '';
  } else {
    exChartContainer.style.display = 'none';
  }
  exSelect.onchange = function() {
    var name = this.value;
    if (!name || !_simData) { prBarDiv.innerHTML = ''; return; }
    var sessions = [];
    var minReps = 0;
    for (var wi = 0; wi < _simData.weeks.length; wi++) {
      var week = _simData.weeks[wi];
      for (var di = 0; di < (week.days || []).length; di++) {
        var day = week.days[di];
        for (var ei = 0; ei < (day.exercises || []).length; ei++) {
          var ex = day.exercises[ei];
          if (ex.name === name) {
            sessions.push({ week: week.week, day: day.day, schedule_pos: day.schedule_pos, schedule_mode: day.schedule_mode, wt: ex.weight, reps: ex.reps, rm: ex.predicted_1rm });
            if (minReps === 0) minReps = ex.min_reps;
          }
        }
      }
    }
    if (sessions.length === 0) { prBarDiv.innerHTML = ''; return; }

    // Compute PR range values (same style as muscle tab)
    var peakPR = sessions.reduce(function(max, s) { return s.rm > max ? s.rm : max; }, 0);
    var floorPR = peakPR * 0.7;
    var currentPR = sessions[sessions.length - 1].rm;
    var peakConverted = convert1RMToWeight(peakPR, minReps);
    var floorConverted = convert1RMToWeight(floorPR, minReps);
    var currentConverted = convert1RMToWeight(currentPR, minReps);
    var suggestedLow = computeWeightRIR3(currentPR, minReps);
    var suggestedHigh = computeWeightRIR0(currentPR, minReps);

    // PR range bar
    var prMin = peakConverted * 0.5;
    var prMax = peakConverted || 1;
    var pct = function(v) { return v <= prMin ? 0 : (((v - prMin) / (prMax - prMin)) * 100).toFixed(1); };

    prBarDiv.innerHTML =
      '<div class="pr-bar-chart">' +
        '<div class="pr-bar-legend">' +
          '<span class="pr-bar-legend-item"><span class="pr-bar-legend-dot" style="background:#bc8cff"></span> Peak</span>' +
          '<span class="pr-bar-legend-item"><span class="pr-bar-legend-dot" style="background:#8b949e"></span> Floor</span>' +
          '<span class="pr-bar-legend-item"><span class="pr-bar-legend-dot" style="background:rgba(63,185,80,0.5)"></span> Rec</span>' +
        '</div>' +
        '<div class="pr-bar-track-wrap">' +
          '<div class="pr-bar-range" style="left:' + pct(floorConverted) + '%;width:' + (100 - pct(floorConverted)) + '%"></div>' +
          (suggestedLow > 0 && suggestedHigh > 0 ? '<div class="pr-bar-recommend" style="left:' + pct(suggestedLow) + '%;width:' + (pct(suggestedHigh) - pct(suggestedLow)) + '%"></div>' : '') +
          '<div class="pr-marker" style="left:' + pct(floorConverted) + '%">' +
            '<div class="pr-marker-line" style="background:#8b949e"></div>' +
            '<div class="pr-marker-label" style="color:#8b949e">' + formatNum(floorConverted,1) + '</div>' +
          '</div>' +
          '<div class="pr-marker" style="left:' + pct(peakConverted) + '%">' +
            '<div class="pr-marker-line" style="background:#bc8cff"></div>' +
            '<div class="pr-marker-label" style="color:#bc8cff">' + formatNum(peakConverted,1) + '</div>' +
          '</div>' +
          (suggestedLow > 0 ? '<div class="pr-marker" style="left:' + pct(suggestedLow) + '%">' +
            '<div class="pr-marker-line" style="background:#3fb950"></div>' +
            '<div class="pr-marker-label" style="color:#3fb950">' + formatNum(suggestedLow,1) + '</div>' +
          '</div>' : '') +
          '<div class="pr-marker" style="left:' + pct(currentConverted) + '%">' +
            '<div class="pr-marker-line" style="background:#d29922"></div>' +
            '<div class="pr-marker-label pr-marker-label-bottom" style="color:#d29922">' + formatNum(currentConverted,1) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="pr-bar-scale">' +
          '<span>' + formatNum(prMin,1) + ' (50% Peak)</span>' +
          '<span>' + formatNum(prMax,1) + ' (Peak)</span>' +
        '</div>' +
        '<div class="pr-bar-stats">' +
          '<span class="pr-bar-stat">Peak 1RM: <strong>' + formatNum(peakPR,1) + ' kg</strong></span>' +
          '<span class="pr-bar-stat">Floor 1RM: <strong>' + formatNum(floorPR,1) + ' kg</strong></span>' +
          '<span class="pr-bar-stat">PR DK 1RM: <strong>' + formatNum(currentPR,1) + ' kg</strong></span>' +
          '<span class="pr-bar-stat">Reps: <strong>' + minReps + 'RM</strong></span>' +
        '</div>' +
      '</div>';

    var labels = sessions.map(function(s) { return s.schedule_mode === 'cycle' ? 'W' + s.week + 'D' + (s.schedule_pos || s.day) : 'W' + s.week + 'D' + s.day; });
    var rm1Converted = sessions.map(function(s) { return convert1RMToWeight(s.rm, minReps); });
    // Convert each session's (weight, reps) to equivalent weight at minReps (Epley)
    // so rep-only progression shows as visible upward slope on the chart
    var wtData = sessions.map(function(s) { return s.wt * (30 + s.reps) / (30 + minReps); });
    var recLowData = sessions.map(function(s) { return s.rm > 0 ? computeWeightRIR3(s.rm, minReps) : null; });
    var recHighData = sessions.map(function(s) { return s.rm > 0 ? computeWeightRIR0(s.rm, minReps) : null; });
    if (chartInstances.programEx) chartInstances.programEx.destroy();
    var progExDatasets = [];
    if (recLowData.some(function(v) { return v !== null; }) && recHighData.some(function(v) { return v !== null; })) {
      progExDatasets.push(
        { label: 'Rec Low', data: recLowData, borderColor: 'rgba(63,185,80,0.3)', backgroundColor: 'rgba(63,185,80,0.08)', fill: '+1', pointRadius: 0, borderDash: [3, 3] },
        { label: 'Rec High', data: recHighData, borderColor: 'rgba(63,185,80,0.3)', pointRadius: 0, borderDash: [3, 3] }
      );
    }
    progExDatasets.push(
      { label: 'PR d\u1ef1 ki\u1ebfn (' + minReps + 'RM) (' + name + ')', data: rm1Converted, borderColor: '#3fb950', tension: 0.3, pointRadius: 0, spanGaps: true },
      { label: 'Weight (' + minReps + 'RM equiv.)', data: wtData, borderColor: '#d29922', tension: 0.3, pointRadius: 3, spanGaps: true }
    );
    chartInstances.programEx = new Chart(document.getElementById('programExChart'), {
      type: 'line',
      data: { labels: labels, datasets: progExDatasets },
      options: commonOpts()
    });
  };
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
  { key: 'google_client_id',    label: 'Google Client ID',                 desc: 'OAuth 2.0 client ID from Google Cloud Console.', group: 'Google Calendar', type: 'text' },
  { key: 'google_client_secret', label: 'Google Client Secret',            desc: 'OAuth 2.0 client secret.',                   group: 'Google Calendar', type: 'password' },
  { key: 'google_calendar_id',  label: 'Google Calendar ID',               desc: 'Calendar ID (email) or "primary".',          group: 'Google Calendar', type: 'text' },
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

function buildTextField(def, currentVal) {
  return `
    <div class="param-row">
      <div class="param-info">
        <span class="param-label">${def.label}</span>
        <span class="param-desc">${def.desc}</span>
      </div>
      <div class="param-controls">
        <input type="${def.type || 'text'}" class="param-text" data-key="${def.key}"
               value="${escapeHtml(String(currentVal || ''))}" style="width:100%;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px 10px;font-size:0.85rem">
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
    html += def.type === 'text' || def.type === 'password' ? buildTextField(def, params[def.key]) : buildParamField(def, params[def.key]);
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
    document.querySelectorAll('.param-text').forEach(inp => {
      updates[inp.dataset.key] = inp.value;
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

  /* Sync 2nd time range selector with 1st + auto-save */
  document.getElementById('time-range').addEventListener('change', () => {
    document.getElementById('time-range-2').value = document.getElementById('time-range').value;
    localStorage.setItem('savedTimeRange', document.getElementById('time-range').value);
  });
  document.getElementById('time-range-2').addEventListener('change', () => {
    document.getElementById('time-range').value = document.getElementById('time-range-2').value;
    localStorage.setItem('savedTimeRange', document.getElementById('time-range-2').value);
  });
  document.getElementById('date-from-tss').addEventListener('change', () => {
    localStorage.setItem('savedTimeRange', document.getElementById('date-from-tss').value + '|' + document.getElementById('date-to-tss').value);
  });
  document.getElementById('date-to-tss').addEventListener('change', () => {
    localStorage.setItem('savedTimeRange', document.getElementById('date-from-tss').value + '|' + document.getElementById('date-to-tss').value);
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

  /* TSS detail modal close */
  const tdModal = document.getElementById('tss-detail-modal');
  tdModal.querySelector('.tss-detail-close').addEventListener('click', () => { tdModal.style.display = 'none'; });
  tdModal.addEventListener('click', (e) => { if (e.target === tdModal) tdModal.style.display = 'none'; });
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
    document.getElementById('np-mode-selector').querySelectorAll('.schedule-mode-option').forEach(el => {
      const isWeek = el.dataset.mode === 'week';
      el.classList.toggle('active', isWeek);
      el.querySelector('input').checked = isWeek;
    });
    document.getElementById('np-weeks').value = '4';
    npModal.style.display = 'flex';
    document.getElementById('np-name').focus();
  });
  // Mode selector in new program modal
  document.getElementById('np-mode-selector').addEventListener('click', (e) => {
    const opt = e.target.closest('.schedule-mode-option');
    if (!opt) return;
    document.querySelectorAll('#np-mode-selector .schedule-mode-option').forEach(el => {
      el.classList.toggle('active', el === opt);
      el.querySelector('input').checked = el === opt;
    });
  });
  document.getElementById('np-create').addEventListener('click', async () => {
    const name = document.getElementById('np-name').value.trim();
    if (!name) return;
    const mode = document.querySelector('#np-mode-selector input[name="np-mode"]:checked').value;
    const weeks = parseInt(document.getElementById('np-weeks').value) || 4;
    let schedule = null;
    if (mode === 'cycle') {
      schedule = { '0': null };
    }
    npModal.style.display = 'none';
    try {
      const res = await fetchJSON('/api/programs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, weeks, schedule_mode: mode, schedule }) });
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
    await fetch('/api/programs/' + currentProgramId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, weeks })
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
    const dayCount = p.days ? p.days.length : 0;
    if (dayCount >= 7) return;
    const nextDay = dayCount + 1;
    await fetch('/api/programs/' + currentProgramId + '/days', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day_number: nextDay })
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

  document.getElementById('btn-sync-google').addEventListener('click', async () => {
    if (!currentProgramId) return;
    const weeks = parseInt(document.getElementById('program-weeks').value) || 4;
    const startDate = document.getElementById('program-ical-date').value;
    if (!startDate) { alert('Please select a start date.'); return; }
    const statusEl = document.getElementById('google-sync-status');
    statusEl.innerHTML = 'Syncing...';
    statusEl.style.color = '#8b949e';
    try {
      const res = await fetch(`/api/programs/${currentProgramId}/sync-google?weeks=${weeks}&start_date=${startDate}`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.created !== undefined) {
        statusEl.innerHTML = `✓ Synced ${data.created} events`;
        statusEl.style.color = '#3fb950';
      } else {
        const msg = data.error || 'Sync failed';
        if (msg.includes('client_id') || msg.includes('client_secret')) {
          const authRes = await fetch('/api/google/auth-url');
          const authData = await authRes.json();
          if (authData.url) {
            statusEl.innerHTML = `✗ Configure OAuth: set google_client_id and google_client_secret in params.json, then <a href="${authData.url}" target="_blank" style="color:#58a6ff">authorize here</a>`;
          } else {
            statusEl.innerHTML = `✗ ${msg}`;
          }
        } else if (msg.includes('refresh_token') || msg.includes('authUrl')) {
          const authRes = await fetch('/api/google/auth-url');
          const authData = await authRes.json();
          if (authData.url) {
            statusEl.innerHTML = `✗ <a href="${authData.url}" target="_blank" style="color:#58a6ff">Click to authorize Google Calendar</a>, then sync again`;
          } else {
            statusEl.innerHTML = `✗ ${msg}`;
          }
        } else {
          statusEl.innerHTML = '✗ ' + escapeHtml(msg);
        }
        statusEl.style.color = '#f85149';
      }
    } catch (e) {
      statusEl.innerHTML = '✗ Error: ' + e.message;
      statusEl.style.color = '#f85149';
    }
  });

  /* Restore auto-saved time range */
  const saved = localStorage.getItem('savedTimeRange');
  if (saved) {
    if (saved.includes('|')) {
      const [from, to] = saved.split('|');
      if (from && to) {
        document.getElementById('time-range').value = 'custom';
        document.getElementById('time-range-2').value = 'custom';
        document.getElementById('date-from-tss').value = from;
        document.getElementById('date-to-tss').value = to;
        document.querySelector('#controls-tss .date-range-group').style.display = 'flex';
      }
    } else {
      document.getElementById('time-range').value = saved;
      document.getElementById('time-range-2').value = saved;
    }
  }

  /* Initial render */
  document.getElementById('time-range').value = document.getElementById('time-range').value || '84';
  document.getElementById('time-range-2').value = document.getElementById('time-range-2').value || '84';
  renderTSS();
}

document.addEventListener('DOMContentLoaded', init);


