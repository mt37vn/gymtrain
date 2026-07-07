// Plate calculator for gyms with mixed units: bar in kg, plates in lbs-converted-to-kg.
// User's plates (per side): 1.1, 2.2, 4.5, 11.3, 15.9, 20.6 kg (2.5/5/10/25/35/45 lbs).

const PLATES_KG = [1.1, 2.2, 4.5, 11.3, 15.9, 20.6];
const BAR_KG = 20;

function findBestCombo(targetKgPerSide) {
  let bestDiff = Infinity;
  let candidates = [];
  function dfs(idx, sum, counts) {
    if (idx === PLATES_KG.length) {
      const diff = Math.abs(sum - targetKgPerSide);
      if (diff < bestDiff - 0.5) {
        bestDiff = diff;
        candidates = [[...counts]];
      } else if (diff <= bestDiff + 0.5) {
        candidates.push([...counts]);
      }
      return;
    }
    for (let c = 0; c <= 2; c++) {
      counts.push(c);
      dfs(idx + 1, sum + c * PLATES_KG[idx], counts);
      counts.pop();
    }
  }
  dfs(0, 0, []);
  // Among candidates, pick the one with fewest total plates
  let best = candidates[0];
  let bestCount = best.reduce((s, c) => s + c, 0);
  for (let i = 1; i < candidates.length; i++) {
    const count = candidates[i].reduce((s, c) => s + c, 0);
    if (count < bestCount) { bestCount = count; best = candidates[i]; }
  }
  const totalSide = best.reduce((s, c, i) => s + c * PLATES_KG[i], 0);
  return { counts: best, perSideKg: Math.round(totalSide * 10) / 10 };
}

function nearestPlateWeight(barKg, targetTotalKg) {
  const perSide = (targetTotalKg - barKg) / 2;
  if (perSide <= 0) return { totalKg: barKg, perSideKg: 0, plates: [], diff: targetTotalKg - barKg };
  const combo = findBestCombo(perSide);
  const totalKg = Math.round((barKg + 2 * combo.perSideKg) * 10) / 10;
  const plates = PLATES_KG.map((kg, i) => ({ kg, count: combo.counts[i] })).filter(p => p.count > 0);
  return { totalKg, perSideKg: combo.perSideKg, plates, diff: Math.round((totalKg - targetTotalKg) * 10) / 10 };
}

module.exports = { nearestPlateWeight, PLATES_KG, BAR_KG };
