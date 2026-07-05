async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

function formatNum(v, d = 1) { return Number(v).toFixed(d); }

function tssColor(v) {
  if (v > 0) return '#3fb950';
  return '#8b949e';
}

async function render() {
  const [summary, timeline, plateaus, stats] = await Promise.all([
    fetchJSON('/api/summary'),
    fetchJSON('/api/timeline'),
    fetchJSON('/api/plateaus'),
    fetchJSON('/api/stats')
  ]);

  if (summary.error) {
    document.body.innerHTML = '<p style="padding:40px;color:#f85149;">No data available. Run the analysis first.</p>';
    return;
  }

  document.getElementById('stats-bar').textContent =
    `${stats.totalSets} sets · ${stats.totalDays} days`;

  const cards = document.getElementById('summary-cards');
  cards.innerHTML = `
    <div class="card"><h3>CTL</h3><div class="value positive">${formatNum(summary.ctl)}</div></div>
    <div class="card"><h3>ATL</h3><div class="value negative">${formatNum(summary.atl)}</div></div>
    <div class="card"><h3>TSB</h3><div class="value ${summary.tsb >= 0 ? 'positive' : 'negative'}">${formatNum(summary.tsb)}</div></div>
    <div class="card"><h3>M (Muscle)</h3><div class="value neutral">${formatNum(summary.m, 4)}</div></div>
    <div class="card"><h3>PR</h3><div class="value positive">${formatNum(summary.pr, 1)} kg</div></div>
    <div class="card"><h3>1RM Pred</h3><div class="value positive">${formatNum(summary.rm1_predicted, 1)} kg</div></div>
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
    alertsEl.innerHTML += `<div class="alert plateau">📈 Plateau detected on ${last.day_key}: Weight Mult ${formatNum(last.old_mult, 3)} → ${formatNum(last.new_mult, 3)}</div>`;
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

  new Chart(document.getElementById('fatigueChart'), {
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

  new Chart(document.getElementById('muscleChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: 'M', data: mData, borderColor: '#58a6ff', backgroundColor: 'rgba(88,166,255,0.1)', fill: true, tension: 0.3, pointRadius: 0 }]
    },
    options: commonOpts
  });

  new Chart(document.getElementById('rmChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'PR', data: prData, borderColor: '#3fb950', tension: 0.3, pointRadius: 0 },
        { label: '1RM Pred', data: rm1Data, borderColor: '#bc8cff', tension: 0.3, pointRadius: 0 }
      ]
    },
    options: commonOpts
  });

  new Chart(document.getElementById('tssChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'TSS', data: tssData, backgroundColor: tssData.map(v => v > 0 ? 'rgba(63,185,80,0.6)' : 'rgba(48,54,61,0.3)'), borderRadius: 2 }]
    },
    options: { ...commonOpts, scales: { ...commonOpts.scales, y: { ...commonOpts.scales.y, beginAtZero: true } } }
  });

  const tbody = document.querySelector('#plateau-table tbody');
  tbody.innerHTML = plateaus.map(p =>
    `<tr><td>${p.day_key}</td><td>${formatNum(p.old_mult, 3)}</td><td>${formatNum(p.new_mult, 3)}</td></tr>`
  ).join('');
}

document.addEventListener('DOMContentLoaded', render);
