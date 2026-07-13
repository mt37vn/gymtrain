// Plate calculator for gyms with mixed units: bar in kg, plates in lbs-converted-to-kg.
// User's plates (per side): 1.1, 2.2, 4.5, 11.3, 15.9, 20.6 kg (2.5/5/10/25/35/45 lbs).

const PLATES_KG = [1.1, 2.2, 4.5, 11.3, 15.9, 20.6];
const BAR_KG = 20;

// Tie tolerance (kg per side): only combos essentially as close as the best fit
// are considered interchangeable, so fewest-plates never overrides a closer weight.
const TIE_TOL = 0.1;

function findBestCombo(targetKgPerSide) {
  const combos = [];
  function dfs(idx, sum, counts) {
    if (idx === PLATES_KG.length) {
      combos.push({ counts: [...counts], sum });
      return;
    }
    for (let c = 0; c <= 2; c++) {
      counts.push(c);
      dfs(idx + 1, sum + c * PLATES_KG[idx], counts);
      counts.pop();
    }
  }
  dfs(0, 0, []);

  // True closest fit first, then only break near-exact ties by fewest plates.
  const trueBestDiff = Math.min(...combos.map(c => Math.abs(c.sum - targetKgPerSide)));
  const candidates = combos.filter(c => Math.abs(c.sum - targetKgPerSide) <= trueBestDiff + TIE_TOL);

  const plateCount = c => c.counts.reduce((s, x) => s + x, 0);
  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i];
    const dc = plateCount(c) - plateCount(best);
    // Prefer fewer plates; break equal-plate ties by the weight closest to target.
    if (dc < 0 || (dc === 0 &&
        Math.abs(c.sum - targetKgPerSide) < Math.abs(best.sum - targetKgPerSide))) {
      best = c;
    }
  }
  return { counts: best.counts, perSideKg: Math.round(best.sum * 10) / 10 };
}

function nearestPlateWeight(barKg, targetTotalKg) {
  const perSide = (targetTotalKg - barKg) / 2;
  if (perSide <= 0) return { totalKg: barKg, perSideKg: 0, plates: [], diff: targetTotalKg - barKg };
  const combo = findBestCombo(perSide);
  const totalKg = Math.round((barKg + 2 * combo.perSideKg) * 10) / 10;
  const plates = PLATES_KG.map((kg, i) => ({ kg, count: combo.counts[i] })).filter(p => p.count > 0);
  return { totalKg, perSideKg: combo.perSideKg, plates, diff: Math.round((totalKg - targetTotalKg) * 10) / 10 };
}

// Largest achievable total load that does not exceed maxTotalKg (fewest plates on ties).
function plateWeightAtMost(barKg, maxTotalKg) {
  const maxPerSide = (maxTotalKg - barKg) / 2;
  if (maxPerSide < 0) return barKg;
  let best = { sum: 0, count: 0 };
  (function dfs(idx, sum, count) {
    if (idx === PLATES_KG.length) {
      if (sum <= maxPerSide + 1e-9 &&
          (sum > best.sum + 1e-9 || (Math.abs(sum - best.sum) < 1e-9 && count < best.count))) {
        best = { sum, count };
      }
      return;
    }
    for (let c = 0; c <= 2; c++) dfs(idx + 1, sum + c * PLATES_KG[idx], count + c);
  })(0, 0, 0);
  return Math.round((barKg + 2 * best.sum) * 10) / 10;
}

module.exports = { nearestPlateWeight, plateWeightAtMost, PLATES_KG, BAR_KG };
