import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { dayLight, lightLabel, localDay, PHASE_ICONS, shootableWindows, type DayLight, type Interval } from "@openclapper/vocab";
import { deleteDay, fetchDays, putDay, type DayShot, type Project, type Shot, type ShootingDay } from "./api";
import { binned } from "./apps/trashOps";
import * as data from "./data";
import { keepLocal } from "./TimelineParts";
import { cover, positionOf, shotTitle } from "./format";
import { Framed, type MaskMode } from "./Framed";
import { invalidateDays } from "./Inspector";
import { bind, useKeys } from "./keys";
import { Banner, Button, Checkbox, cx, Empty, EmptyNote, Field, Icon, IconButton, Input, Kbd, ListRow, MenuItem, Panel, PanelBody, PanelHead, Popover, ReorderButtons, SaveStatus, Select, Spinner, toast, type SaveState } from "@openclapper/ui";
import { fetchForecast, weatherText, type HourForecast } from "./weather";

interface Props {
  project: Project;
  /** The project's shots. */
  shots: Shot[];
  mask: MaskMode;
  dayId: string | null;
  onDay: (id: string | null) => void;
  onOpen: (s: Shot, list: Shot[]) => void;
  /** The open day's label and the save state, for the window title and its close guard. */
  onStatus?: (s: { name: string | null; save: SaveState }) => void;
}

const BERLIN = { lat: 52.52, lon: 13.405 };
const hhmm = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const windowsText = (w: Interval[]) => (w.length ? w.map((x) => `${hhmm(x.start)}–${hhmm(x.end)}`).join(", ") : "not on this day");
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
/** YYYY-MM-DD in the viewer's time zone (toISOString would give the UTC date). */
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function nextSaturday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return isoDate(d);
}
/** Centre of the shots' positions (for sun and weather), Berlin when none has one. */
function centroid(shots: Shot[]): { lat: number; lon: number } {
  const ps = shots.map(positionOf).filter((p): p is { lat: number; lon: number } => !!p);
  if (ps.length === 0) return BERLIN;
  return { lat: ps.reduce((a, p) => a + p.lat, 0) / ps.length, lon: ps.reduce((a, p) => a + p.lon, 0) / ps.length };
}
function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const x of sorted) {
    const last = out.at(-1);
    if (last && x.start.getTime() <= last.end.getTime()) { if (x.end > last.end) last.end = x.end; }
    else out.push({ start: x.start, end: x.end });
  }
  return out;
}
const atTime = (start: Date, hm: string) => { const [h, m] = hm.split(":").map(Number); const d = new Date(start); d.setHours(h, m, 0, 0); return d; };
const plannedFits = (planned: string | null, start: Date, w: Interval[]) => !planned || w.some((x) => atTime(start, planned) >= x.start && atTime(start, planned) < x.end);

/** Plan: shooting days of the project against the light and the forecast. Changes autosave per day. */
export function PlanPage({ project, shots, mask, dayId, onDay, onOpen, onStatus }: Props) {
  const [days, setDays] = useState<ShootingDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const projectId = project.id;
  useEffect(() => {
    setDays(null);
    fetchDays(projectId).then((d) => {
      setDays(d);
      if (!dayId || !d.some((x) => x.id === dayId)) onDay(d.find((x) => x.date >= isoDate(new Date()))?.id ?? d.at(-1)?.id ?? null);
    }).catch((e: Error) => setError(e.message));
  }, [projectId]);

  // Edits save shortly after the last change, per day; leaving the page saves at once.
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; day: ShootingDay }>());
  // A day binned or restored elsewhere (Files, the bin, Undo): re-read the days, keeping this
  // window's copies of the ones it still has; a day that went away is left for the next one.
  const dayRef = useRef(dayId);
  dayRef.current = dayId;
  useEffect(() => data.onTrash((e) => {
    if (e.projectId !== projectId || (e.type !== "day" && e.type !== "folder")) return;
    if (e.kind === "binned") { const p = pending.current.get(e.id); if (p) { clearTimeout(p.timer); pending.current.delete(e.id); } }
    fetchDays(projectId).then((fresh) => {
      setDays((cur) => keepLocal(cur, fresh));
      if (dayRef.current && !fresh.some((x) => x.id === dayRef.current)) onDay(fresh.find((x) => x.date >= isoDate(new Date()))?.id ?? fresh.at(-1)?.id ?? null);
    }).catch(() => {});
  }), [projectId]);
  const [save, setSave] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const flushDay = (d: ShootingDay) => {
    pending.current.delete(d.id);
    setSave("saving");
    putDay(d).then(() => { invalidateDays(d.project_id); if (pending.current.size === 0) { setSave("saved"); setSavedAt(new Date()); } }).catch((e: Error) => { setSave("error"); setError(e.message); pending.current.set(d.id, { day: d, timer: setTimeout(() => {}, 0) }); });
  };
  useEffect(() => () => { for (const { timer, day } of pending.current.values()) { clearTimeout(timer); void putDay(day).catch(() => {}); } pending.current.clear(); }, []);
  const retry = () => { for (const { day } of [...pending.current.values()]) flushDay(day); };
  function change(d: ShootingDay) {
    setDays((cur) => (cur ?? []).map((x) => (x.id === d.id ? d : x)).sort((a, b) => a.date.localeCompare(b.date)));
    setSave("dirty");
    const prev = pending.current.get(d.id);
    if (prev) clearTimeout(prev.timer);
    pending.current.set(d.id, { day: d, timer: setTimeout(() => flushDay(d), 600) });
  }
  async function create() {
    const d: ShootingDay = { id: crypto.randomUUID(), project_id: projectId, date: nextSaturday(), title: null, notes: null, shots: [], created_at: "", updated_at: null };
    try { const saved = await putDay(d); invalidateDays(projectId); setDays((cur) => [...(cur ?? []), saved].sort((a, b) => a.date.localeCompare(b.date))); onDay(saved.id); } catch (e) { toast(`Could not create the day: ${(e as Error).message}`, "danger"); }
  }
  /** To the recycle bin with Undo; a pending edit is sent first so the restored copy has it. */
  async function remove(d: ShootingDay) {
    try {
      const p = pending.current.get(d.id);
      if (p) { clearTimeout(p.timer); pending.current.delete(d.id); await putDay(p.day); }
      await deleteDay(d.id); invalidateDays(d.project_id); setDays((cur) => (cur ?? []).filter((x) => x.id !== d.id)); onDay(null);
      binned([{ type: "day", id: d.id }], d.project_id, `${dateLabel(d.date)}${d.title ? ` · ${d.title}` : ""}`);
    } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }

  useKeys(bind("plan", { newDay: () => void create() }));


  const day = days?.find((d) => d.id === dayId) ?? null;
  const today = isoDate(new Date());
  const dayName = day ? `${dateLabel(day.date)}${day.title ? ` · ${day.title}` : ""}` : null;
  useEffect(() => { onStatus?.({ name: dayName, save }); }, [dayName, save]);
  return (
    <div class="f-app__body">
      <Panel left width="280px" label="Shooting days">
        <PanelHead title="Shooting days"><Button size="sm" icon="plus" title="New day (⇧N)" onClick={() => void create()}>New day</Button></PanelHead>
        <PanelBody flush role="listbox" aria-label="Days">
          {!days ? <div class="status"><Spinner /></div> : days.length === 0 ? (
            <EmptyNote title="No days yet">“New day” starts on the next Saturday.</EmptyNote>
          ) : days.map((d) => (
            <div key={d.id} role="option" aria-selected={d.id === dayId} tabIndex={0} class={cx("f-dayitem", d.id === dayId && "is-selected", d.date < today && "is-past")} onClick={() => onDay(d.id)} onKeyDown={(e) => { if (e.key === "Enter") onDay(d.id); }}>
              <span class="f-dayitem__date">{dateLabel(d.date)}{d.date === today ? " · today" : ""}</span>
              <span class="f-dayitem__meta">{d.title || "Untitled"} · {d.shots.length} shot{d.shots.length === 1 ? "" : "s"}</span>
            </div>
          ))}
        </PanelBody>
      </Panel>
      {days && days.length === 0 ? (
        <Empty icon="calendar-blank-outline" title={`No shooting days in ${project.name}`} actions={<Button icon="plus" onClick={() => void create()}>New day</Button>}>
          Plan which approved shots to shoot on which day, against the light and the forecast.
        </Empty>
      ) : day ? (
        <DayEditor key={day.id} day={day} shots={shots} mask={mask} onChange={change} onDelete={() => void remove(day)} onOpen={onOpen}
          save={save} savedAt={savedAt} onRetry={retry} error={save === "error" ? error : null} />
      ) : (
        <Empty icon="calendar-blank-outline" title="Pick a day" />
      )}
    </div>
  );
}

interface EditorProps {
  day: ShootingDay; shots: Shot[]; mask: MaskMode; onChange: (d: ShootingDay) => void; onDelete: () => void; onOpen: (s: Shot, list: Shot[]) => void;
  save: SaveState; savedAt: Date | null; onRetry: () => void; error: string | null;
}

function DayEditor({ day, shots, mask, onChange, onDelete, onOpen, save, savedAt, onRetry, error }: EditorProps) {
  const [adding, setAdding] = useState(day.shots.length === 0);
  const [menu, setMenu] = useState(false);
  const [focus, setFocus] = useState(0);
  const rowsRef = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(shots.map((s) => [s.id, s])), [shots]);
  const planned = day.shots.map((ds) => ({ ds, shot: byId.get(ds.shot_id) })).filter((x): x is { ds: DayShot; shot: Shot } => !!x.shot);
  const where = centroid(planned.length ? planned.map((x) => x.shot) : shots);
  const { start, hours } = localDay(day.date);
  const light = useMemo(() => dayLight(start, where.lat, where.lon, hours), [day.date, where.lat, where.lon]);
  const [forecast, setForecast] = useState<HourForecast[] | null | "loading">("loading");
  useEffect(() => {
    setForecast("loading");
    void fetchForecast(where.lat, where.lon, start, new Date(start.getTime() + hours * 3_600_000)).then(setForecast);
  }, [day.date, where.lat.toFixed(2), where.lon.toFixed(2)]);

  const setShots = (list: DayShot[]) => onChange({ ...day, shots: list });
  const move = (i: number, delta: number) => { if (i + delta < 0 || i + delta >= day.shots.length) return; const l = [...day.shots]; const [x] = l.splice(i, 1); l.splice(i + delta, 0, x); setShots(l); setFocus(i + delta); };
  const plannedList = planned.map((x) => x.shot);
  const focused = planned[focus];
  const idxOf = (ds: DayShot) => day.shots.indexOf(ds);

  useKeys(bind("plan", {
    down: () => setFocus((f) => Math.min(planned.length - 1, f + 1)),
    up: () => setFocus((f) => Math.max(0, f - 1)),
    earlier: () => focused && move(idxOf(focused.ds), -1),
    later: () => focused && move(idxOf(focused.ds), 1),
    time: () => { rowsRef.current?.querySelectorAll<HTMLInputElement>(".f-time input")[focus]?.focus(); },
    remove: () => { if (focused) setShots(day.shots.filter((x) => x !== focused.ds)); },
    add: () => setAdding((a) => !a),
    open: () => { if (focused) onOpen(focused.shot, plannedList); },
  }));

  // Consecutive shots of the same location form a group, keeping the day's order.
  const groups: { name: string; items: { ds: DayShot; shot: Shot; flat: number }[] }[] = [];
  planned.forEach(({ ds, shot }, flat) => {
    const name = shot.location_name ?? "No location";
    const last = groups.at(-1);
    if (last && last.name === name) last.items.push({ ds, shot, flat });
    else groups.push({ name, items: [{ ds, shot, flat }] });
  });
  const pct = (d: Date) => Math.max(0, Math.min(100, ((d.getTime() - start.getTime()) / (hours * 3_600_000)) * 100));
  const lane = (w: Interval[]) => w.map((x) => ({ l: pct(x.start), w: pct(x.end) - pct(x.start), key: x.start.toISOString() }));

  return (
    <>
      <div class="f-scroll">
        <div class="plan-day" ref={rowsRef}>
          {error && (
            <Banner role="alert" icon="cloud-alert" title="Not saved" meta={`${error}. Your changes are kept here; they save on retry or on the next edit.`} action={<Button kind="secondary" size="sm" onClick={onRetry}>Retry</Button>} />
          )}
          <div class="plan-head">
            <Field label="Date" style={{ width: "170px" }}><Input type="date" class="num" style={{ fontWeight: 700 }} value={day.date} onInput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) onChange({ ...day, date: v }); }} /></Field>
            <Field label="Title" style={{ flex: 1, minWidth: "220px" }}><Input value={day.title ?? ""} placeholder="e.g. Moabit and the river" onInput={(e) => onChange({ ...day, title: (e.target as HTMLInputElement).value || null })} /></Field>
            <div class="plan-head__status">
              <SaveStatus state={save} onRetry={onRetry} savedLabel={savedAt ? `Saved ${hhmm(savedAt)}` : "Saved"} />
              <div class="menu-anchor">
                <IconButton icon="dots-horizontal" label="Day menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
                {menu && <Popover right onClose={() => setMenu(false)}><MenuItem icon="delete-outline" danger onClick={() => { setMenu(false); onDelete(); }}>Delete day…</MenuItem></Popover>}
              </div>
            </div>
          </div>
          <Field label="Notes"><textarea class="f-textarea" rows={2} placeholder="Call time, permits, crew…" value={day.notes ?? ""} onInput={(e) => onChange({ ...day, notes: (e.target as HTMLTextAreaElement).value || null })} /></Field>

          <div class="light-box">
            <div class="f-dayrow">
              <div class="lead"><strong>Light</strong><span class="meta">at the centre of the day’s shots</span></div>
              <LightTrack light={light} start={start} hours={hours} pct={pct} />
              <div class="f-tl__keys num" style={{ gridColumn: "3 / 5" }}>
                {light.sunrise && <span title="Sunrise"><Icon name="weather-sunset-up" /><b>{hhmm(light.sunrise)}</b></span>}
                {light.sunset && <span title="Sunset"><Icon name="weather-sunset-down" /><b>{hhmm(light.sunset)}</b></span>}
                <span>max <b>{light.maxElevation.toFixed(1)}°</b></span>
              </div>
            </div>
            <div class="f-dayrow">
              <div class="lead"><strong>Forecast</strong><span class="meta">Open-Meteo</span></div>
              <Forecast forecast={forecast} date={day.date} pct={pct} hours={hours} />
              <div class="f-tl__keys" style={{ gridColumn: "3 / 5" }}><span><Icon name="cloud-outline" />cloud</span><span><Icon name="weather-rainy" />rain ≥ 30 %</span></div>
            </div>
            <div class="f-dayrow">
              <span />
              <div class="f-tl__keys meta num">{light.phases.filter((ph) => ph.phase === "dawn" || ph.phase === "dusk").map((ph) => <span key={ph.start.toISOString()}>{ph.phase === "dawn" ? "Dawn" : "Dusk"} <b>{hhmm(ph.start)}–{hhmm(ph.end)}</b></span>)}</div>
            </div>
          </div>

          <div class="plan-shots-head">
            <h2>Planned shots <span class="meta num">{planned.length}</span></h2>
            {planned.some((x) => x.ds.planned_time) && <Button kind="secondary" size="sm" icon="sort-clock-ascending-outline" onClick={() => setShots([...day.shots].sort((a, b) => (a.planned_time ?? "99").localeCompare(b.planned_time ?? "99")))}>Sort by planned time</Button>}
            <Button kind={adding ? "secondary" : "primary"} size="sm" icon="plus" kbd="N" aria-pressed={adding} onClick={() => setAdding(!adding)}>Add shots</Button>
          </div>
          {groups.length === 0 && <EmptyNote dashed title="No shots on this day">Add approved shots from the panel. Each one shows its window for this date.</EmptyNote>}
          {groups.map((g, gi) => {
            const union = mergeIntervals(g.items.flatMap(({ shot }) => shootableWindows(light, shot.light)));
            return (
              <div class="f-daygroup" key={`${g.name}-${gi}`}>
                <div class="f-daygroup__head f-dayrow">
                  <div class="lead-row"><Icon name="map-marker-outline" size={18} /><strong class="ellipsis">{g.name}</strong><span class="meta">{g.items.length} shot{g.items.length === 1 ? "" : "s"}</span></div>
                  <div class="f-tl__lane"><div class="f-tl__lanebg" />{lane(union).map((w) => <div key={w.key} class="f-tl__win" style={{ left: `${w.l}%`, width: `${w.w}%`, opacity: 0.45 }} />)}</div>
                  <span class="win-text num" style={{ gridColumn: "3 / 5" }}>{windowsText(union)}</span>
                </div>
                {g.items.map(({ ds, shot, flat }) => {
                  const w = shootableWindows(light, shot.light);
                  const fits = plannedFits(ds.planned_time, start, w);
                  const i = idxOf(ds);
                  return (
                    <div key={shot.id} class={cx("f-daygroup__row f-dayrow", flat === focus && "is-focus")} onClick={() => setFocus(flat)}>
                      <div class="lead-row">
                        <button type="button" class="f-table__thumb" style={{ border: 0, padding: 0, cursor: "pointer", flex: "none" }} aria-label={`Open ${shotTitle(shot)}`} onClick={() => onOpen(shot, plannedList)}><Framed photo={cover(shot)} mode={mask} /></button>
                        <div class="lead-text"><strong class="ellipsis">{shotTitle(shot)}</strong><span class="meta ellipsis">{lightLabel(shot.light, shot.artificial) || "Any time"} · <b style={{ color: w.length ? "var(--ok)" : "var(--warn-ink)" }}>{w.length ? windowsText(w) : "not on this day"}</b></span></div>
                      </div>
                      <div class="f-tl__lane" style={{ height: "22px" }}>
                        <div class="f-tl__lanebg" />
                        {lane(w).map((x) => <div key={x.key} class="f-tl__win" style={{ left: `${x.l}%`, width: `${x.w}%` }} />)}
                        {ds.planned_time && <div class={cx("f-tl__mark", fits ? "f-tl__mark--plan" : "f-tl__mark--bad")} style={{ left: `${pct(atTime(start, ds.planned_time))}%` }} title={fits ? "Planned time" : "Planned outside the shot’s light"} />}
                      </div>
                      <div class="f-field" style={{ gap: "2px" }}>
                        <span class={cx("f-input f-input--sm f-time", !fits && "is-bad")}><input type="time" aria-label="Planned time" value={ds.planned_time ?? ""} onInput={(e) => setShots(day.shots.map((x) => (x === ds ? { ...x, planned_time: (e.target as HTMLInputElement).value || null } : x)))} /></span>
                        {!fits && <span class="f-field__error" style={{ fontSize: "11px" }}><Icon name="alert-circle" />Outside window</span>}
                      </div>
                      <div class="btn-row" style={{ gap: "2px", justifyContent: "flex-end" }}>
                        <ReorderButtons index={i} count={day.shots.length} onMove={move} onRemove={() => setShots(day.shots.filter((x) => x !== ds))}
                          up={{ label: "Move up (Alt+↑)", title: "Move up (Alt+↑)" }} down={{ label: "Move down (Alt+↓)", title: "Move down (Alt+↓)" }} remove={{ label: "Remove from day", title: "Remove from day (Del)" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {adding && <AddShotsPanel shots={shots} light={light} taken={new Set(day.shots.map((x) => x.shot_id))} mask={mask} onClose={() => setAdding(false)}
        onAdd={(ids) => setShots([...day.shots, ...ids.map((shot_id) => ({ shot_id, planned_time: null, notes: null }))])} />}
    </>
  );
}

function LightTrack({ light, start, hours, pct }: { light: DayLight; start: Date; hours: number; pct: (d: Date) => number }) {
  const ticks = Array.from({ length: Math.floor(hours / 2) + 1 }, (_, i) => new Date(start.getTime() + i * 2 * 3_600_000));
  const now = new Date();
  const showNow = now >= start && now.getTime() < start.getTime() + hours * 3_600_000;
  return (
    <div class="f-tl">
      <div class="f-tl__track" style={{ position: "relative" }}>
        {light.phases.map((p) => {
          const w = pct(p.end) - pct(p.start);
          return (
            <div key={p.start.toISOString()} class={`f-tl__seg f-tl__seg--${p.phase}`} title={`${p.phase} ${hhmm(p.start)}–${hhmm(p.end)}`} style={{ left: `${pct(p.start)}%`, width: `${w}%` }}>
              {w > 4 && <Icon name={PHASE_ICONS[p.phase]} />}{w > 9 && p.phase}
            </div>
          );
        })}
        <div class="f-tl__overlay">
          {light.sunrise && <div class="f-tl__mark f-tl__mark--sun" style={{ left: `${pct(light.sunrise)}%` }} />}
          {light.sunset && <div class="f-tl__mark f-tl__mark--sun" style={{ left: `${pct(light.sunset)}%` }} />}
          {showNow && <div class="f-tl__mark f-tl__mark--now" style={{ left: `${pct(now)}%` }} title={`Now ${hhmm(now)}`} />}
        </div>
      </div>
      <div class="f-tl__ticks">{ticks.map((t, i) => <span key={i} style={{ left: `${pct(t)}%`, transform: i === 0 ? "none" : pct(t) >= 99 ? "translateX(-100%)" : undefined }}>{String(t.getHours()).padStart(2, "0")}</span>)}</div>
    </div>
  );
}

function Forecast({ forecast, date, pct, hours }: { forecast: HourForecast[] | null | "loading"; date: string; pct: (d: Date) => number; hours: number }) {
  if (forecast === "loading") return <span class="f-loading meta"><Spinner />Loading forecast…</span>;
  if (forecast === null) return <div class="f-wx__none"><Icon name="weather-cloudy-clock" />{dateLabel(date)} is outside the forecast (about 16 days ahead).</div>;
  const w = `${100 / hours}%`;
  const tip = (h: HourForecast) => `${hhmm(h.time)} · ${weatherText(h.code)} · cloud ${h.cloudPct} % · rain ${h.precipProb ?? 0} % · ${Math.round(h.tempC)} °C`;
  return (
    <div class="wx">
      <div class="wx-track wx-cloud">{forecast.map((h) => <div key={h.time.toISOString()} class="f-wx__cloud" style={{ left: `${pct(h.time)}%`, width: w }} title={tip(h)}><i style={{ top: "auto", right: 0, height: `${h.cloudPct}%` }} /></div>)}</div>
      <div class="wx-track wx-rain">{forecast.map((h) => <div key={h.time.toISOString()} class="f-wx__rain" style={{ left: `${pct(h.time)}%`, width: w }} title={tip(h)}><i class={(h.precipProb ?? 0) < 30 ? "is-low" : ""} style={{ height: `${Math.max(h.precipProb ?? 0, 8)}%` }} /></div>)}</div>
      <div class="wx-track wx-temp">{forecast.filter((h) => h.time.getHours() % 3 === 0).map((h) => <span key={h.time.toISOString()} class="f-wx__temp" style={{ left: `${pct(h.time)}%` }} title={tip(h)}>{Math.round(h.tempC)}°</span>)}</div>
    </div>
  );
}

function AddShotsPanel({ shots, light, taken, mask, onAdd, onClose }: { shots: Shot[]; light: DayLight; taken: Set<string>; mask: MaskMode; onAdd: (ids: string[]) => void; onClose: () => void }) {
  const [location, setLocation] = useState<string>("");
  const [onlyApproved, setOnlyApproved] = useState(true);
  const notOnDay = shots.filter((s) => !taken.has(s.id) && (!onlyApproved || s.state === "approved"));
  const candidates = notOnDay.filter((s) => !location || (s.location_id ?? "none") === location);
  const locations = [...new Map(shots.map((s) => [s.location_id ?? "none", s.location_name ?? "No location"])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const byLocation = new Map<string, Shot[]>();
  for (const s of candidates) { const k = s.location_name ?? "No location"; byLocation.set(k, [...(byLocation.get(k) ?? []), s]); }
  useKeys(bind("plan", { closeAdd: onClose }));
  return (
    <Panel label="Add shots" width="340px">
      <PanelHead title="Add shots"><Kbd>N</Kbd><IconButton icon="close" label="Close" onClick={onClose} /></PanelHead>
      <div class="panel-filters">
        <Select label="Location" icon="map-marker-outline" value={location} onChange={setLocation}
          options={[{ value: "", label: "All locations" }, ...locations.map(([id, name]) => ({ value: id, label: name }))]} />
        <Checkbox checked={onlyApproved} role="checkbox" aria-checked={onlyApproved} onClick={() => setOnlyApproved(!onlyApproved)}>
          Approved only <span class="meta">· {notOnDay.length} not on this day</span>
        </Checkbox>
      </div>
      <PanelBody style={{ gap: "14px" }}>
        {candidates.length === 0 && <span class="meta">No more shots to add{onlyApproved ? ". Approve shots in Review first, or untick “Approved only”." : "."}</span>}
        {[...byLocation.entries()].map(([name, list]) => (
          <div key={name} class="add-group">
            <div class="add-group__head"><strong class="ellipsis">{name}</strong><span class="meta">{list.length}</span><Button kind="ghost" size="sm" onClick={() => onAdd(list.map((s) => s.id))}>Add all</Button></div>
            {list.map((s) => {
              const w = shootableWindows(light, s.light);
              return (
                <ListRow key={s.id} class="add-row" tooltip="Add to the day" onClick={() => onAdd([s.id])}
                  thumb={<div class="f-row__thumb" style={{ width: "56px" }}><Framed photo={cover(s)} mode={mask} /></div>}
                  title={shotTitle(s)}
                  meta={<>{lightLabel(s.light, s.artificial) || "Any time"} · <b style={{ color: w.length ? "var(--ok)" : "var(--warn-ink)" }}>{w.length ? windowsText(w) : "no fitting light"}</b></>}
                  trailing={<Icon name="plus" size={20} />} />
              );
            })}
          </div>
        ))}
      </PanelBody>
    </Panel>
  );
}
