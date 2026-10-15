import { useMemo, useRef, useState } from "preact/hooks";
import { fetchTimelines, patchShot, promoteClip, type Preset, type Project, type Shot, type Timeline, type TimelineClip } from "./api";
import { guardCut, useClipEditing, type EditKind } from "./ClipEditing";
import { placeLabel, shotTitle } from "./format";
import type { MaskMode } from "./Framed";
import { ScrubCover, SeqBadges } from "./ShotCard";
import { afterG, useKeys } from "./keys";
import type { CutPosition } from "./router";
import { useSettings } from "./settings";
import { ClipMenu, ClipPanel, clock, CutDecision, CutPreview, DRAWER_RESIZE, duplicateUnit, fillSpot, insertAfterUnit, insertShot, moveUnitTo, normalizeGroups, restorePhotos, setGroup, stepUnit, ungroup, withoutClip, duplicateTimeline, LockSelect, TimelineRail, newPlaceholder, resolveClips, setShotState, shotDrag, shotUsage, DECISIONS, Strip, useCut, useCutUrl, useTimelineStore, type Cut, type ResolvedClip } from "./TimelineParts";
import { Banner, Button, ContextMenu, cx, Empty, EmptyNote, Field, Icon, IconButton, Input, MenuItem, Panel, PanelBody, PanelHead, promptDialog, SaveStatus, Seg, Select, StateMarker, toast, useCtxMenu, type SaveState } from "./ui";

/**
 * Review as a timeline-first workspace (issue #31): the selected cut on stage, the project's shots
 * in a browser beside it. Reviewing means finding the shots that carry a sequence — drag them into
 * the strip, re-frame a clip or draw its overlay inline on the stage (ClipEditing.tsx), sketch the
 * shots you still lack, approve or archive from the browser. The Timeline page edits the same
 * timelines without the browser.
 */

interface Props {
  project: Project;
  /** The project's shots. */
  shots: Shot[];
  presets: Preset[];
  mask: MaskMode;
  timelineId: string | null;
  /** The URL's playhead and inline tool, restored when the workspace opens. */
  at?: CutPosition | null;
  onTimeline: (id: string | null) => void;
  onOpen: (s: Shot, list: Shot[]) => void;
  onUpdated: (s: Shot | Shot[]) => void;
  onShowOnMap: (s: Shot) => void;
  onNewShot: () => void;
}

export function ReviewPage(p: Props) {
  const projectId = p.project.id;
  const store = useTimelineStore((set, fail) => {
    fetchTimelines(projectId).then((t) => { set(t); if (!p.timelineId || !t.some((x) => x.id === p.timelineId)) p.onTimeline(t[0]?.id ?? null); }).catch(fail);
  }, [projectId]);
  const { list, save } = store;
  const create = async () => { const t = await store.create(projectId); if (t) p.onTimeline(t.id); };
  const railMenu = useCtxMenu<Timeline>();
  useKeys({ "Shift+N": () => void create() });

  async function rename(t: Timeline) {
    const name = await promptDialog({ title: "Rename timeline", input: { label: "Name", value: t.name }, confirmLabel: "Rename" });
    if (name && name !== t.name) store.change({ ...t, name });
  }
  async function duplicate(t: Timeline) {
    try {
      await store.saveNow(t.id);
      const copy = await duplicateTimeline(t);
      store.setList((cur) => [...(cur ?? []), copy]);
      p.onTimeline(copy.id);
    } catch (e) { toast(`Duplicate failed: ${(e as Error).message}`, "danger"); }
  }
  const remove = async (t: Timeline) => { if (await store.remove(t)) p.onTimeline(null); };

  const current = list?.find((t) => t.id === p.timelineId) ?? null;
  return (
    <div class="f-app__body">
      <TimelineRail list={list} selectedId={p.timelineId} onSelect={p.onTimeline} onCreate={() => void create()} onContext={(t, e) => railMenu.openMenu(e, t)} />
      {railMenu.menu && (
        <ContextMenu x={railMenu.menu.x} y={railMenu.menu.y} label="Timeline" onClose={railMenu.closeMenu}>
          <MenuItem icon="pencil-outline" onClick={() => void rename(railMenu.menu!.ctx)}>Rename…</MenuItem>
          <MenuItem icon="content-duplicate" onClick={() => void duplicate(railMenu.menu!.ctx)}>Duplicate</MenuItem>
          <MenuItem icon="delete-outline" danger onClick={() => void remove(railMenu.menu!.ctx)}>Delete timeline…</MenuItem>
        </ContextMenu>
      )}
      {current
        ? <Workspace key={current.id} timeline={current} {...p} save={save} onChange={store.change} onRetry={store.retry} error={save === "error" ? store.error : null} onDelete={() => void remove(current)} onRename={() => void rename(current)} onSaveNow={store.saveNow} onReplace={store.replace} />
        : list && list.length === 0
          ? <><Empty icon="filmstrip" title={`No timelines in ${p.project.name}`} actions={<Button icon="plus" onClick={() => void create()}>New timeline</Button>}>Reviewing is building a cut: drag shots in, hold spots with placeholders or sketches, re-frame clips and draw on them right on the stage.</Empty><Browser {...p} onAdd={null} usage={null} /></>
          : <Empty icon="filmstrip" title="Pick a timeline" />}
    </div>
  );
}

interface WorkspaceProps extends Props {
  timeline: Timeline;
  onSaveNow: (id: string) => Promise<void>;
  onReplace: (t: Timeline) => void;
  save: SaveState;
  onChange: (t: Timeline) => void;
  onRetry: () => void;
  error: string | null;
  onDelete: () => void;
  onRename: () => void;
}

function Workspace(p: WorkspaceProps) {
  const { timeline: t, shots, mask } = p;
  const byId = useMemo(() => new Map(shots.map((s) => [s.id, s])), [shots]);
  const clips = useMemo(() => resolveClips(t, byId), [t, byId]);
  const total = clips.reduce((a, c) => a + c.clip.duration_ms, 0);
  const cut = useCut(clips);
  const { cur } = cut;
  const [panel, setPanel] = useState<"browser" | "clip">("browser");
  const stripRef = useRef<HTMLDivElement>(null);
  const durRef = useRef<HTMLInputElement>(null);
  const clipMenu = useCtxMenu<ResolvedClip>();
  const settings = useSettings();
  // Every change keeps the sequence blocks consistent (issue #37).
  const change = (next: Timeline) => p.onChange(normalizeGroups(next));
  const inline = useClipEditing({ timeline: t, clips, presets: p.presets, onChange: change });

  const setClips = (list: TimelineClip[]) => change({ ...t, clips: list });
  const update = (id: string, patch: Partial<TimelineClip>) => setClips(t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const move = (c: ResolvedClip, d: number) => setClips(stepUnit(t.clips, c.clip.id, d));
  /** `index` counts rendered clips; map it into the stored list (dead clips are skipped in render). */
  const storedIndex = (index: number) => (index >= clips.length ? t.clips.length : t.clips.indexOf(clips[index].clip));
  const reorder = (clipId: string, index: number) => setClips(moveUnitTo(t.clips, clipId, storedIndex(index)));
  const removeClip = (c: ResolvedClip) => {
    const next = withoutClip(t.clips, c.clip.id, settings.seqRemove === "block");
    const kept = new Set(next.map((x) => x.id));
    const i = clips.indexOf(c);
    const n = clips.slice(i + 1).find((x) => kept.has(x.clip.id)) ?? clips.slice(0, i).reverse().find((x) => kept.has(x.clip.id));
    setClips(next);
    cut.select(n?.clip.id ?? null);
  };
  const duplicate = async (c: ResolvedClip) => {
    try {
      const { copies, group } = await duplicateUnit(t, c.clip.id);
      change(insertAfterUnit(latest.current, c.clip.id, copies, group));
      cut.select(copies[0].id);
    } catch (e) { toast(`Duplicate failed: ${(e as Error).message}`, "danger"); }
  };
  const latest = useRef(t); latest.current = t;
  const addPlaceholder = () => { const ph = newPlaceholder("Placeholder"); setClips([...t.clips, ph]); cut.select(ph.id); setPanel("clip"); };
  const shotList = [...new Map(clips.flatMap((c) => (c.kind === "photo" ? [[c.shot.id, c.shot] as const] : []))).values()];
  const open = (c: ResolvedClip) => { if (c.kind === "photo") p.onOpen(c.shot, shotList.length ? shotList : [c.shot]); };
  const usage = useMemo(() => shotUsage(clips), [clips]);

  // While a clip is edited inline the playhead is pinned to it, or moving away ends the edit (Settings → Timeline).
  const guarded = guardCut(cut, inline, settings.inlinePlayhead);
  const selectClip = (id: string | null) => { guarded.select(id); if (id && !inline.editing) setPanel("clip"); };
  const guardedCut: Cut = { ...guarded, select: selectClip };
  const edit = (kind: EditKind, c: ResolvedClip) => { cut.select(c.clip.id); setPanel("clip"); inline.start(kind, c); };
  useCutUrl("review", t.id, clips, cut, inline.editing?.kind ?? null, edit, p.at);
  /** The browser's "in this timeline" badge: the shot's first clip, then the next one on each click. The browser stays open. */
  const jumpTo = (shotId: string) => {
    const ids = usage.get(shotId);
    if (!ids?.length) return;
    const at = cur ? ids.indexOf(cur.clip.id) : -1;
    guarded.select(ids[(at + 1) % ids.length]);
  };

  /** An unreviewed shot that earned a place in the cut can be approved right away. */
  const offerApprove = (s: Shot) => {
    if (s.state !== "unreviewed") return;
    toast(`${shotTitle(s)} is still unreviewed`, "info", { label: "Approve", run: () => void patchShot(s.id, { state: "approved" }).then(p.onUpdated).catch((e: Error) => toast(`Update failed: ${e.message}`, "danger")) });
  };
  const addShot = (s: Shot, index?: number) => {
    const r = insertShot(t, s, mask, index);
    change(r.t);
    if (!inline.editing) cut.select(r.first);
    offerApprove(s);
  };
  const onDropShot = (shotId: string, at: { index: number } | { fill: string }) => {
    const s = byId.get(shotId);
    if (!s) return;
    if ("index" in at) return addShot(s, storedIndex(at.index));
    // Fill the placeholder (or sketch clip): hold time and notes stay, a sketch stays the clip's own; a sequence fills it as a block in that time.
    const ph = t.clips.find((c) => c.id === at.fill);
    if (!ph) return;
    if (inline.editing?.clipId === ph.id) { toast("Finish editing this clip first", "info"); return; }
    change(fillSpot(t, ph.id, s, mask));
    if (!inline.editing) cut.select(ph.id);
    offerApprove(s);
  };
  /** The sketch a spot had before a shot filled it becomes that shot's sketch. */
  async function attachSketch(c: ResolvedClip) {
    if (c.kind !== "photo" || !c.ownSketch) return;
    try {
      await p.onSaveNow(t.id);
      const r = await promoteClip(t.id, c.clip.id, { what: "sketch", shot_id: c.shot.id, sketch_id: c.ownSketch.id });
      p.onReplace(r.timeline);
      p.onUpdated(r.shot);
      toast(`“${c.ownSketch.name}” is now a sketch of ${shotTitle(r.shot)}`);
    } catch (e) { toast(`Attaching failed: ${(e as Error).message}`, "danger"); }
  }

  useKeys({
    ArrowRight: () => cut.step(1),
    ArrowLeft: () => cut.step(-1),
    Home: () => clips[0] && selectClip(clips[0].clip.id),
    End: () => clips.at(-1) && selectClip(clips.at(-1)!.clip.id),
    " ": cut.toggle,
    "Alt+ArrowRight": () => { if (cur) move(cur, 1); },
    "Alt+ArrowLeft": () => { if (cur) move(cur, -1); },
    Delete: () => { if (cur && panel === "clip") removeClip(cur); },
    d: () => durRef.current?.focus(),
    n: () => setPanel(panel === "browser" ? "clip" : "browser"),
    p: addPlaceholder,
    r: () => { if (afterG()) return false; if (cur?.kind === "photo") edit("reframe", cur); },
    c: () => { if (afterG()) return false; if (cur) edit(cur.kind === "photo" ? "overlay" : "sketch", cur); },
    Enter: () => { if (cur) open(cur); },
  }, !inline.editing);

  return (
    <>
      <div class="f-scroll tl-main">
        <div class="plan-day" style={{ gap: "14px" }}>
          {p.error && <Banner role="alert" icon="cloud-alert" title="Not saved" meta={`${p.error}. Your changes are kept here; they save on retry or on the next edit.`} action={<Button kind="secondary" size="sm" onClick={p.onRetry}>Retry</Button>} />}
          <div class="plan-head">
            <Field label="Name" style={{ flex: 1, minWidth: "220px" }}><Input value={t.name} maxLength={120} style={{ fontWeight: 700 }} onInput={(e) => p.onChange({ ...t, name: (e.target as HTMLInputElement).value || "Untitled" })} /></Field>
            <Field label="Length"><span class="f-input num" style={{ fontWeight: 700, padding: "0 10px", display: "inline-flex", alignItems: "center" }}>{clock(total)} · {clips.length} clip{clips.length === 1 ? "" : "s"}</span></Field>
            <Field label="Presentation" as="div"><LockSelect value={t.lock_mode} onChange={(m) => p.onChange({ ...t, lock_mode: m })} /></Field>
            <CutDecision clips={clips} onUpdated={p.onUpdated} />
            <div class="plan-head__status"><SaveStatus state={p.save} onRetry={p.onRetry} /></div>
          </div>

          <CutPreview cut={guardedCut} clips={clips} total={total} lock={t.lock_mode} stage={inline.stage} editing={!!inline.editing}>
            <Button kind="secondary" size="sm" icon="image-off-outline" kbd="P" disabled={!!inline.editing} onClick={addPlaceholder}>Placeholder</Button>
            <Button kind={panel === "browser" ? "secondary" : "primary"} size="sm" icon="view-grid-outline" kbd="N" aria-pressed={panel === "browser"} disabled={!!inline.editing} onClick={() => setPanel(panel === "browser" ? "clip" : "browser")}>Shots</Button>
          </CutPreview>

          <Strip clips={clips} cut={guardedCut} stripRef={stripRef} lock={t.lock_mode} editingId={inline.editing?.clipId ?? null} onOpen={open} onReorder={reorder} onDropShot={onDropShot} onContext={(c, e) => clipMenu.openMenu(e, c)} />
        </div>
      </div>
      {clipMenu.menu && <ClipMenu menu={clipMenu.menu} onClose={clipMenu.closeMenu} onEdit={edit} onOpen={open} onDuplicate={(c) => void duplicate(c)} onRemove={removeClip} onState={(s, to) => void setShotState(s, to, p.onUpdated)} />}
      {inline.panel ?? (panel === "clip" && cur
        ? <ClipPanel key={cur.clip.id} c={cur} count={clips.length} lock={t.lock_mode} durRef={durRef} onUpdate={(patch) => update(cur.clip.id, patch)} onMove={(d) => move(cur, d)} onRemove={() => removeClip(cur)} onDuplicate={() => void duplicate(cur)} onOpen={() => open(cur)}
            onReframe={() => edit("reframe", cur)} onOverlay={() => edit("overlay", cur)} onSketch={() => edit("sketch", cur)} onAttachSketch={() => void attachSketch(cur)}
            onState={cur.kind === "photo" ? (to) => void setShotState(cur.shot, to, p.onUpdated) : undefined}
            onGroup={(g) => change(setGroup(t, g))} onUngroup={() => cur.clip.group_id && change(ungroup(t, cur.clip.group_id))}
            onRestore={() => cur.kind === "photo" && cur.clip.group_id && change(restorePhotos(t, cur.clip.group_id, cur.shot, mask))}
            head={<><span class="meta num">clip {cur.index + 1} of {clips.length}</span><IconButton icon="view-grid-outline" label="Browse shots (N)" title="Browse shots (N)" onClick={() => setPanel("browser")} /></>} />
        : <Browser {...p} onAdd={addShot} usage={usage} onJump={jumpTo} />)}
    </>
  );
}

// ---------- The shot browser: find, judge, drag in ----------

type StateFilter = "review" | "unreviewed" | "approved" | "archived" | "all";
const STATE_OPTIONS: { value: StateFilter; label: string }[] = [
  { value: "review", label: "To review + Approved" },
  { value: "unreviewed", label: "To review" },
  { value: "approved", label: "Approved" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All states" },
];
const inState = (s: Shot, f: StateFilter) => f === "all" || (f === "review" ? s.state !== "archived" : s.state === f);
type CutFilter = "" | "out" | "in";
const CUT_OPTIONS: { value: CutFilter; label: string }[] = [
  { value: "", label: "In this timeline or not" },
  { value: "out", label: "Not in this timeline" },
  { value: "in", label: "In this timeline" },
];

/** The browser's layout and filters, remembered per browser so they survive leaving Review (issue #35). */
interface BrowserPrefs { cols: "1" | "2"; state: StateFilter; location: string; inCut: CutFilter; q: string }
const PREFS_KEY = "reviewBrowser";
const DEFAULT_PREFS: BrowserPrefs = { cols: "2", state: "review", location: "", inCut: "", q: "" };
function readPrefs(): BrowserPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<BrowserPrefs>;
    return {
      cols: v.cols === "1" ? "1" : "2",
      state: STATE_OPTIONS.some((o) => o.value === v.state) ? v.state! : "review",
      location: typeof v.location === "string" ? v.location : "",
      inCut: CUT_OPTIONS.some((o) => o.value === v.inCut) ? v.inCut! : "",
      q: typeof v.q === "string" ? v.q : "",
    };
  } catch { return DEFAULT_PREFS; }
}

interface BrowserProps extends Props {
  onAdd: ((s: Shot) => void) | null;
  /** Shot id → the clips of the timeline on stage that use it (null: no timeline). */
  usage: Map<string, string[]> | null;
  onJump?: (shotId: string) => void;
}

function Browser(p: BrowserProps) {
  const [prefs, setPrefs] = useState(readPrefs);
  const set = (patch: Partial<BrowserPrefs>) => setPrefs((cur) => {
    const next = { ...cur, ...patch };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* per-browser convenience */ }
    return next;
  });
  const { cols, state, inCut, q } = prefs;
  const menu = useCtxMenu<Shot>();
  const [sel, setSel] = useState<string | null>(null);
  const locations = [...new Map(p.shots.map((s) => [s.location_id ?? "none", s.location_name ?? "No location"])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  // A remembered location of another project shows as "All locations".
  const location = locations.some(([id]) => id === prefs.location) ? prefs.location : "";
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return p.shots
      .filter((s) => inState(s, state) && (!location || (s.location_id ?? "none") === location))
      .filter((s) => !inCut || !p.usage || (inCut === "in") === p.usage.has(s.id))
      .filter((s) => !needle || shotTitle(s).toLowerCase().includes(needle) || placeLabel(s).toLowerCase().includes(needle))
      .sort((a, b) => b.captured_at.localeCompare(a.captured_at));
  }, [p.shots, state, location, q, inCut, p.usage]);
  const selected = list.find((s) => s.id === sel) ?? null;

  const decide = (s: Shot, to: Shot["state"]) => void setShotState(s, to, p.onUpdated);
  useKeys({
    a: () => { if (selected) decide(selected, "approved"); },
    e: () => { if (selected) decide(selected, selected.state === "archived" ? "unreviewed" : "archived"); },
  }, !!selected);

  const unreviewed = p.shots.filter((s) => s.state === "unreviewed").length;
  return (
    <Panel label="Shots" width="380px" resize={DRAWER_RESIZE}>
      <PanelHead title="Shots"><span class="meta num">{unreviewed} to review</span>
        <Seg label="Cards per row" value={cols} onChange={(v) => set({ cols: v })} options={[{ id: "2", icon: "view-grid-outline", title: "Two per row" }, { id: "1", icon: "view-agenda-outline", title: "One per row: bigger cards" }]} />
        <IconButton icon="image-plus" label="New shot" title="New shot: upload or sketch" onClick={p.onNewShot} /></PanelHead>
      <div class="panel-filters">
        <Select label="State" icon="checkbox-marked-outline" value={state} onChange={(v) => set({ state: v as StateFilter })} options={STATE_OPTIONS} />
        <Select label="Location" icon="map-marker-outline" value={location} onChange={(v) => set({ location: v })} options={[{ value: "", label: "All locations" }, ...locations.map(([id, name]) => ({ value: id, label: name }))]} />
        {p.usage && <Select label="Timeline" icon="filmstrip" value={inCut} onChange={(v) => set({ inCut: v as CutFilter })} options={CUT_OPTIONS} />}
        <Input sm value={q} placeholder="Search name or location…" onInput={(e) => set({ q: (e.target as HTMLInputElement).value })} />
      </div>
      <PanelBody>
        <span class="meta">Drag a shot into the strip, or onto a placeholder to fill it. Double-click opens it.</span>
        {list.length === 0 && <EmptyNote title="No shots match">Change the state, location or timeline filter.</EmptyNote>}
        <div class={cx("rw-grid", cols === "1" && "rw-grid--one")}>
          {list.map((s) => { const uses = p.usage?.get(s.id)?.length ?? 0; return (
            // A div, not a button: the quick actions inside are buttons of their own.
            <div key={s.id} role="button" tabIndex={0} class={cx("f-card rw-card", sel === s.id && "is-selected")} {...shotDrag(s.id)}
              onClick={() => setSel(s.id)} onDblClick={() => p.onOpen(s, list)} onContextMenu={(e) => { setSel(s.id); menu.openMenu(e, s); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setSel(s.id); } }}
              title={`${shotTitle(s)} · drag into the strip`}>
              <ScrubCover shot={s} mask={p.mask} badges={(at) => (<>
                <SeqBadges count={s.photos.length} at={at} />
                <div class="f-card__tr rw-card__tr">
                  <StateMarker state={s.state} iconOnly />
                  {uses > 0 && (
                    <button type="button" class="rw-used" title={`In this timeline${uses > 1 ? ` ${uses} times` : ""} · click to jump to ${uses > 1 ? "the next clip" : "the clip"}`} aria-label={`In this timeline, ${uses} clip${uses === 1 ? "" : "s"}`}
                      draggable={false} onClick={(e) => { e.stopPropagation(); setSel(s.id); p.onJump?.(s.id); }} onDblClick={(e) => e.stopPropagation()}>
                      <Icon name="filmstrip" />{uses > 1 && <span class="num">×{uses}</span>}
                    </button>
                  )}
                </div>
              </>)} />
              <div class="f-card__body rw-card__body">
                <div class="rw-card__txt">
                  <span class="f-card__title">{shotTitle(s)}</span>
                  <span class="f-card__sub">{[placeLabel(s), s.photos.length > 1 ? `${s.photos.length} photos` : "", s.overlays.length ? `${s.overlays.length} overlay${s.overlays.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") || "—"}</span>
                </div>
                {/* The decisions in the foot, always visible (issue #35): the two states the shot is not in. */}
                <div class="rw-card__acts" onDblClick={(e) => e.stopPropagation()}>
                  {DECISIONS.filter((d) => d.to !== s.state).map((d) => {
                    const key = d.to === "approved" ? "A" : d.to === "archived" || s.state === "archived" ? "E" : null;
                    const tip = key ? `${d.label} (${key})` : d.label;
                    return <IconButton key={d.to} kind={d.to === "approved" ? "approve" : "archive"} icon={d.icon} label={tip} title={tip} onClick={(e) => { e.stopPropagation(); decide(s, d.to); }} />;
                  })}
                </div>
              </div>
            </div>
          ); })}
        </div>
      </PanelBody>
      {menu.menu && (() => {
        const s = menu.menu.ctx;
        return (
          <ContextMenu x={menu.menu.x} y={menu.menu.y} label="Shot" onClose={menu.closeMenu}>
            {p.onAdd && <MenuItem icon="plus" onClick={() => p.onAdd!(s)}>Add to timeline</MenuItem>}
            {s.state !== "approved" && <MenuItem icon="check" onClick={() => decide(s, "approved")}>Approve</MenuItem>}
            {s.state !== "archived" && <MenuItem icon="archive-arrow-down-outline" onClick={() => decide(s, "archived")}>Archive</MenuItem>}
            {s.state !== "unreviewed" && <MenuItem icon="undo-variant" onClick={() => decide(s, "unreviewed")}>Back to review</MenuItem>}
            <MenuItem icon="image-outline" onClick={() => p.onOpen(s, list)}>Open shot</MenuItem>
            <MenuItem icon="map-marker-outline" onClick={() => p.onShowOnMap(s)}>Show on map</MenuItem>
          </ContextMenu>
        );
      })()}
    </Panel>
  );
}
