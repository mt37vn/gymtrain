# Gym Train - Feature Summary

## LB Mode + Plate Calculator

### Overview
User's gym has 20kg barbell, plates in lbs (2.5/5/10/25/35/45 lbs → 1.1/2.2/4.5/11.3/15.9/20.6 kg). Each exercise in a program can toggle between kg and lb increment mode.

### Files implementing this feature:

#### 1. `src/engine/plate-calc.js` — Plate combination algorithm
- `PLATES_KG = [1.1, 2.2, 4.5, 11.3, 15.9, 20.6]` — plates per side in kg (from lbs)
- `BAR_KG = 20` — barbell weight
- `findBestCombo(targetKgPerSide)` — DFS brute-force of all plate combinations (0-2 of each plate type). Collects all combos within ±0.5 kg of the best fit, then picks the one with **fewest plates**.
- `nearestPlateWeight(barKg, targetTotalKg)` — returns `{ totalKg, perSideKg, plates: [{kg, count}], diff }`

#### 2. `src/engine/program-simulator.js` — Start weight + progression rounding
**Start weight** (after clamp to recLow/recHigh):
- kg mode: `Math.round(startWeight / ex.min_increment) * ex.min_increment` — round to nearest increment
- lb mode: `nearestPlateWeight(20, startWeight).totalKg` — plate calculator

**Progression** (weight increase when reps reach maxRepsThreshold):
- kg mode: `Math.round(nextW / ex.min_increment) * ex.min_increment`
- lb mode: `nearestPlateWeight(20, nextW).totalKg`
- Safety check: if `nextW >= predictedPR`, don't increase weight (just increment reps)

**Progression trigger** (maxRepsThreshold):
- Instead of old predictedPR-based growth, uses: `floor(30 × ((weight + inc) / weight × (1 + minReps/30) - 1))`
- When `currentReps >= maxRepsThreshold`, increase weight by `min_increment` and reset reps to `min_reps`
- Otherwise: `currentReps++` (no Epley cap — reps increase freely)

#### 3. `public/app.js` — Frontend UI
**Exercise template** (loadProgram):
```
<input class="prog-ex-inc" value="${ex.use_lb_inc ? (ex.min_increment * 2.20462).toFixed(1) : ex.min_increment.toFixed(1)}"
  min="${ex.use_lb_inc ? 5 : 0.5}" max="${ex.use_lb_inc ? 110 : 25}" step="${ex.use_lb_inc ? '5' : '0.5'}">
<button class="inc-unit-toggle" data-unit="${ex.use_lb_inc ? 'lb' : 'kg'}">${ex.use_lb_inc ? 'lb' : 'kg'}</button>
<span class="inc-eq">${ex.use_lb_inc ? '≈ ' + ex.min_increment.toFixed(1) + ' kg' : ''}</span>
```
- lb mode: shows lbs value (× 2.20462), min=5, max=110, step=5, eq span shows kg equivalent
- kg mode: shows kg value, min=0.5, max=25, step=0.5, no eq span

**Toggle handler** (inc-unit-toggle click):
- Switching to lb: `value × 2.20462`, step=5, show eq span `≈ X.X kg`
- Switching to kg: `value ÷ 2.20462`, step=0.5, remove eq span
- Dispatches `change` event to trigger auto-save

**Save handlers** (add-exercise + auto-save):
- When toggle is lb: `value ÷ 2.20462` before storing (always stores kg)
- Saves `use_lb_inc: 1` flag alongside `min_increment`

**Database schema**: `program_exercises` table has `use_lb_inc INTEGER DEFAULT 0`

#### 4. `public/formulas.js` — Frontend formula mirrors
- `computeWeightAtRIR(pre, reps, rirPct)` — mirrors `muscle-dynamics.js`

### Exercise chart (Program tab)
Below the TSS/Fitness/Fatigue/TSB chart, an **Exercise 1RM Prediction** section with:
- Dropdown listing all exercises in the program
- Chart with recLow/recHigh bands (same format as Weight Suggestion tab)
- Predicted 1RM line (blue) + Weight line (amber)

### Max Reps column (Program editor)
Shows `floor(30 × ((weight + inc) / weight × (1 + minReps/30) - 1))` — the reps at current weight equivalent to `minReps` at next weight. Synced from simulation data.

### Key formulas summary
| Formula | Location | Description |
|---------|----------|-------------|
| `computeWeightAtRIR` | `muscle-dynamics.js` + `formulas.js` | Weight at given RIR%: `round(pre×30/(30+reps+round(reps×rir)))` |
| `computeEpley1RM` | `muscle-dynamics.js` | `weight × (1 + reps/30)` |
| `trainingStatus` | `neural-fatigue.js` + `formulas.js` | Returns `{label, cls, desc}` from TSB% |
| `nearestPlateWeight` | `plate-calc.js` | Closest achievable weight with available plates |
| `maxReps` (program) | `program-simulator.js` | `floor(30 × ((weight+inc)/weight × (1+minReps/30) - 1))` |

## Program Detail — Plate Recommendation

When `use_lb_inc = 1` for an exercise, the Program Details simulation table shows a **plate breakdown** below the weight (e.g., `1×15.9 + 2×4.5 + 1×1.1`). Plates are sorted largest first.

### How it works:
1. `program-simulator.js` calls `nearestPlateWeight(20, useWeight)` for each lb-mode exercise
2. The response includes `plates` field (string: `count×kg + count×kg + ...`)
3. `showSimulation()` in `app.js` renders the plates inline after the weight when `ex.plates && ex.use_lb_inc`

### Plate set (per side):
1.1, 2.2, 4.5, 11.3, 15.9, 20.6 kg (= 2.5/5/10/25/35/45 lbs)

### Algorithm (`plate-calc.js`):
DFS tries all combinations (0-2 of each plate). Collects all combos within ±0.5 kg of the best diff, then picks the one with the **fewest plates**.

## LB Save Precision

### Critical: Don't round kg at save time
The save handlers (`add-exercise` + `auto-save`) must **never** round the kg value. Example:
- User enters 5 lb → inc = 5 / 2.20462 = 2.267964547... → store as-is
- On reload in lb mode: (2.26796 * 2.20462).toFixed(1) = **5.0** ✓
- If rounded at save: Math.round(5/2.20462 * 10)/10 = 2.3 → (2.3 * 2.20462).toFixed(1) = **5.1** ✗

All rounding happens only at display time via `.toFixed(1)`.

### Display rounding rules:
- Input value: `${(min_increment).toFixed(1)}` (kg mode) or `${(min_increment * 2.20462).toFixed(1)}` (lb mode)
- Eq span: `≈ ${min_increment.toFixed(1)} kg` (lb mode only)
- Step: 0.5 (kg) / 5 (lb)
- Min/Max: 0.5-25 (kg) / 5-110 (lb)
