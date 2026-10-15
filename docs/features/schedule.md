# Schedule (shooting days)

Dashboard **Plan** (`apps/dashboard/src/Plan.tsx`, route `#/plan/<dayId>`), per project. It plans which scouted shots are shot on which day, against the available light.

## Using it

- **Left**: the project's shooting days (past ones dimmed, "today" marked), "New day" (⇧N, defaults to next Saturday). Changes **autosave** 600 ms after the last edit, per day, and are saved immediately when leaving the page. The day header shows Saving… · Saved hh:mm · Not saved (with a banner and Retry; edits are kept).
- **A day**: date, title, the day menu (Delete day… with confirmation), notes, then one block where **everything shares the same time axis**:
  - **Light**: the day at the centre of its shots (Berlin when empty) as coloured phases with icons, sunrise/sunset marks, a now marker on today, and dawn/dusk times and the maximum sun elevation.
  - **Forecast** from Open-Meteo (`weather.ts`, about 16 days ahead, hourly): cloud cover bars, rain bars (solid from 30 %), temperature every 3 h, details on hover. Outside the horizon it says so.
- **Planned shots**, grouped by location in day order, aligned under the same axis:
  - Each location header shows the combined window.
  - Each shot row has:
    - a thumbnail (opens the shot view with the day's shots as its list)
    - the name, light requirement and **shootable window(s)**
    - a lane with the window in green and the planned time as a mark
    - the planned time (red with "Outside window" when it falls outside)
    - ↑/↓/✕
  - Keys: ↑/↓ move between rows, Alt+↑/↓ reorder, `T` focuses the time, Del removes, Enter opens.
  - "Sort by planned time".
- **Add shots** (`N`): a side panel, so the day stays visible. It lists approved shots (untick to see all) not yet on the day, grouped by location, filterable by location, each with its window for that date. Click a row to add it, or "Add all" for a location.

## Light math (`packages/vocab/src/daylight.ts`, tested)

- `sunElevation(date, lat, lon)`: low-precision solar position with no dependencies (also runs offline on the phone). It matches published Berlin sunrise/sunset within 3 minutes.
- `dayLight(dayStart, lat, lon, hours)` samples each minute and returns phases by elevation:
  - `night` below `NIGHT_BELOW = -6°` (end of civil twilight)
  - `dawn` / `dusk` between −6° and `DAY_ABOVE = +6°`, before or after solar noon (blue hour + golden hour)
  - `day` above +6°
  It also returns sunrise/sunset (−0.833°) and noon. The thresholds are tunable constants.
- `shootableWindows(day, light)`: the union of the phases in the shot's `light`. An empty `light` (artificial only, or nothing set) means all day. The Artificial flag does not widen a shot that has phases.
- `localDay("YYYY-MM-DD")` gives local midnight and the day length (23/25 h on DST switches) in the viewer's time zone. The app assumes the viewer and the location share a time zone.

## Storage

`shooting_days` + `day_shots` (ordered, `planned_time` HH:MM, notes). `PUT /api/days/:id` replaces the whole day. Shots of another project, or deleted ones, are dropped silently. A shot moved to another project leaves the old project's days. See [api](../api.md).

The phone reads the same days in its [Day tab](day-mode-offline.md).
