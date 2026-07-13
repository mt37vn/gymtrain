# Program Schedule Modes — Implementation Plan

## Overview

Replace the current `days_per_week` + `day_offsets` system with two explicit schedule modes:

- **Week mode**: Each weekday (Mon-Sun) explicitly assigned a day template or Rest
- **Cycle mode**: N-day cycle (1–14), each position assigned a day template or Rest, auto-repeats

Both modes share the same total-calendar-weeks duration concept (`weeks × 7` days for simulation/export).

---

## 1. Database Schema Changes (`src/database.js`)

### `programs` table — add columns

```sql
ALTER TABLE programs ADD COLUMN schedule_mode TEXT DEFAULT 'week';
ALTER TABLE programs ADD COLUMN schedule_data TEXT;   -- JSON
```

`schedule_data` format:
- **Week mode**: `{"0": <day_id_or_null>, "1": <day_id_or_null>, ..., "6": <day_id_or_null>}`
  - Keys 0–6 = Mon–Sun
- **Cycle mode**: `{"cycle_length": <N>, "0": <day_id_or_null>, ..., "N-1": <day_id_or_null>}`
  - Keys 0 to N-1 = cycle positions

### Migration logic (in `initDatabase()` migration block)

Existing programs have `days_per_week` + `day_offsets`. Convert them:
1. Parse `day_offsets` JSON → array of 0–6
2. Using the FIRST week's rotation logic (same as old simulator), assign day templates to Mon–Sun positions
3. Positions not in day_offsets → `null` (Rest)
4. Write as `schedule_data`, set `schedule_mode = 'week'`
5. `days_per_week` and `day_offsets` remain in schema (unused, kept for reference / safety)

**Migration function**: `migrateProgramSchedule(program)` — called inside `getProgram` and `getAllPrograms` if `schedule_data IS NULL` and old fields exist.

### New `createProgram` signature

```
createProgram(name, weeks, scheduleMode, scheduleData)
```

Remove `daysPerWeek` and `dayOffsets` params.

---

## 2. Backend API (`src/routes/api.js`)

### POST `/programs`
Accepts: `{ name, weeks?, schedule_mode?, schedule? }`
- `schedule` is a JSON object matching the `schedule_data` format above (not stringified — raw JSON)
- Calls `createProgram` with the new signature
- Creates default schedule if none provided

### PUT `/programs/:id`
Accepts: `{ schedule_mode?, schedule? }` alongside existing fields
- Saves `schedule_mode` and `schedule_data` (stringified) via `updateProgram`

### GET `/programs` / GET `/programs/:id`
Include parsed `schedule` (JSON) in response alongside other fields.

---

## 3. Simulator Rewrite (`src/engine/program-simulator.js`)

### Remove
- `trainingDayOffsets()` function entirely
- All MAP constant references

### New simulation algorithm

```js
function simulateProgram(programId, weeksOverride) {
  const program = db.getProgram(programId);
  // ...

  const totalWeeks = weeksOverride || program.weeks;
  const totalCalendarDays = totalWeeks * 7;
  const schedule = parseSchedule(program); // { schedule_mode, assignments: [...dayId|null] }

  for (let cd = 0; cd < totalCalendarDays; cd++) {
    const pos = schedule.mode === 'week' ? cd % 7 : cd % schedule.cycleLength;
    const dayId = schedule.assignments[pos];
    const isTrainingDay = dayId !== null;
    const day = isTrainingDay ? program.days.find(d => d.id === dayId) : null;

    // ... rest of simulation logic per day
  }
}
```

### `parseSchedule(program)` helper

```js
function parseSchedule(program) {
  const data = program.schedule_data ? JSON.parse(program.schedule_data) : null;
  if (program.schedule_mode === 'cycle' && data && data.cycle_length) {
    const assignments = [];
    for (let i = 0; i < data.cycle_length; i++) {
      assignments.push(data[i] !== undefined ? data[i] : null);
    }
    return { mode: 'cycle', cycleLength: data.cycle_length, assignments };
  }
  // Default to week mode
  const assignments = [];
  for (let i = 0; i < 7; i++) {
    assignments.push(data && data[i] !== undefined ? data[i] : null);
  }
  return { mode: 'week', assignments };
}
```

### Day naming in simulation response

- Week mode: `day_name` = DAY_NAMES[dow] (unchanged)
- Cycle mode: `day_name` = day template's name, or `"Cycle Day N"` if rest / unnamed

### Update `showDays` display data

Add `schedule_pos` to returned day objects for display in frontend.

---

## 4. Frontend (`public/app.js`)

### 4a. Program Creation Modal

Replace current modal (name + days_per_week) with:
- Program name
- Mode selector: [Week | Cycle]
- If Week: default all 7 slots = Rest, pre-fill first positions with new day templates based on weeks count (starts with 1 template)
- If Cycle: show "Cycle length" input (1–14), default 7
- Creates program with empty schedule, then opens editor

### 4b. Program Editor — Schedule Section

After the program header (name, weeks, buttons), add a **Schedule section**:

**Week mode** — renders 7 dropdowns in a row:
```
[Mon ▼] [Tue ▼] [Wed ▼] [Thu ▼] [Fri ▼] [Sat ▼] [Sun ▼]
```
Each dropdown lists: "Rest" (default) + all existing day template names.
Saves on change via PUT `/api/programs/:id` with `{ schedule_mode: 'week', schedule: {...} }`.

**Cycle mode** — renders N dropdowns labeled "Day 1" ... "Day N":
```
Cycle length: [7] (1–14, changes regenerate dropdowns)
[Day 1 ▼] [Day 2 ▼] ... [Day N ▼]
```
Same dropdown pattern, saves `{ schedule_mode: 'cycle', schedule: { cycle_length: N, ... } }`.

### 4c. Day Template Editor (unchanged)

The `#program-days-container` stays the same — day templates with exercises, drag-and-drop reorder, etc.

### 4d. Simulation Display

- **Week mode**: chart labels `W1 Mon`, `W1 Tue`, ... (show day name directly)
- **Cycle mode**: chart labels `W1 D1`, `W1 D2`, ... (keep current format, `D` = cycle position 1-based)
- Week grid: shows 7 columns for week mode; shows `cycleLength` columns for cycle mode (first row), filling remaining cells as empty/rest until 7

### 4e. Auto-migration on program load

In `loadProgram()`, after fetching the program, if `schedule_data` is null but old fields exist, call a migration endpoint (or do client-side conversion) and reload.

Actually simpler: have the backend auto-migrate on GET. Frontend just works.

---

## 5. HTML (`public/index.html`)

### Update "New Program" modal
- Add mode radio buttons (Week / Cycle)
- Add cycle length input (hidden when Week selected)

### Add schedule container to program editor
```html
<div id="program-schedule-container">
  <h3>Schedule</h3>
  <div id="schedule-slots"></div>
</div>
```
Placed between the header and `#program-days-container`.

---

## 6. CSS (`public/style.css`)

Add styles for:
- `.schedule-slots-row` — flex row for schedule dropdowns
- `.schedule-slot` — individual slot wrapper with label + dropdown
- `.schedule-slot.rest` — visual cue for rest days
- Mode selector toggle styling
- Responsive handling for many cycle positions

---

## 7. Calendar Export / Google Sync (`src/routes/api.js`)

No structural changes needed — both already iterate `cd` over `weeks * 7` and use `day.day_name`. The new simulator returns the same structure.

---

## 8. Backward Compatibility

### Migration flow
1. `initDatabase()` — adds `schedule_mode` and `schedule_data` columns
2. `getProgram()` and `getAllPrograms()` — detect old-style programs by checking `schedule_data IS NULL AND days_per_week IS NOT NULL`
3. Call `migrateProgramSchedule(program)` which:
   - Parses `day_offsets` → training weekday positions
   - Rotates `program_days` templates across weekdays using old first-week logic
   - Fills positions as `{ "0": dayId or null, ..., "6": dayId or null }`
   - Saves `schedule_data` as JSON string
   - Sets `schedule_mode = 'week'`
   - Returns program with new fields populated

### What migration produces
- Week mode with fixed assignments per weekday (week 1 pattern only)
- Old rotation behavior across weeks is lost (by design — new system is fixed per weekday)

---

## Implementation Order

1. **Database** — add columns, migration function, update CRUD functions
2. **Backend API** — update create/update/read for schedule fields
3. **Simulator** — rewrite distribution logic, remove old functions
4. **Frontend** — program creation modal + schedule editor UI
5. **CSS** — style new elements
6. **Test** — verify week mode, cycle mode, migration
7. **Calendar/Export** — verify no regressions
