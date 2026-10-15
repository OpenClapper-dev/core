import { useMemo, useRef, useState } from "preact/hooks";
import { fetchTimelines, type Preset, type Project, type Shot, type Timeline, type TimelineClip } from "./api";
import { cover, shotTitle } from "./format";
import { Framed, type MaskMode } from "./Framed";
import { guardCut, useClipEditing, type EditKind } from "./ClipEditing";
import { afterG, useKeys } from "./keys";
import type { CutPosition } from "./router";
import { useSettings } from "./settings";
import { ClipMenu, ClipPanel, clock, CutDecision, duplicateUnit, insertAfterUnit, insertShot, moveUnitTo, normalizeGroups, restorePhotos, setGroup, stepUnit, ungroup, withoutClip, CutPreview, DRAWER_RESIZE, LockSelect, TimelineRail, newPlaceholder, resolveClips, setShotState, Strip, useCut, useCutUrl, useTimelineStore, type ResolvedClip } from "./TimelineParts";
import { Banner, Button, Checkbox, Empty, Field, Icon, IconButton, Input, Kbd, ListRow, MenuItem, Panel, PanelBody, PanelHead, Popover, SaveStatus, Select, toast, useCtxMenu, type SaveState } from "./ui";

/**
 * Timeline (issue #12, part 2): rough cuts of a project out of its photos. A clip is one photo,
 * optionally seen through one of its overlays, with a presentation (frame mode + rig frame) and a
 * hold time — or a placeholder holding the spot for a missing shot (issue #31). The strip is
 * proportional to time and reorders by drag; the preview plays the cut. Changes autosave.
 * The Review workspace (Review.tsx) edits the same timelines with a shot browser beside them.
 */

interface Props {
  project: Project;
  /** The project's shots. */
  shots: Shot[];
  presets: Preset[];
  mask: MaskMode;
  timelineId: string | null;
  /** The URL's playhead and inline tool, restored when the editor opens. */
  at?: CutPosition | null;
  onTimeline: (id: string | null) => void;
  onOpen: (s: Shot, list: Shot[]) => void;
  onUpdated: (s: Shot | Shot[]) => void;
}

export function TimelinePage({ project, shots, presets, mask, timelineId, at, onTimeline, onOpen, onUpdated }: Props) {
  const projectId = project.id;
  const store = useTimelineStore((set, fail) => {
    fetchTimelines(projectId).then((t) => { set(t); if (!timelineId || !t.some((x) => x.id === timelineId)) onTimeline(t[0]?.id ?? null); }).catch(fail);
  }, [projectId]);
  const { list, save } = store;
  const create = async () => { const t = await store.create(projectId); if (t) onTimeline(t.id); };
  const remove = async (t: Timeline) => { if (await store.remove(t)) onTimeline(null); };
  useKeys({ "Shift+N": () => void create() });

  const current = list?.find((t) => t.id === timelineId) ?? null;
  return (
    <div class="f-app__body">
      <TimelineRail list={list} selectedId={timelineId} onSelect={onTimeline} onCreate={() => void create()} />
      {list && list.length === 0 ? (
        <Empty icon="filmstrip" title={`No timelines in ${project.name}`} actions={<Button icon="plus" onClick={() => void create()}>New timeline</Button>}>
          Arrange photos and overlays in order, give each a hold time, and play the cut to see which shots carry the sequence.
        </Empty>
      ) : current ? (
        <Editor key={current.id} at={at} timeline={current} shots={shots} presets={presets} mask={mask} onChange={store.change} onDelete={() => void remove(current)} onOpen={onOpen} onUpdated={onUpdated} save={save} onRetry={store.retry} error={save === "error" ? store.error : null} />
      ) : <Empty icon="filmstrip" title="Pick a timeline" />}
    </div>
  );
}

interface EditorProps { timeline: Timeline; at?: CutPosition | null; shots: Shot[]; presets: Preset[]; mask: MaskMode; onChange: (t: Timeline) => void; onDelete: () => void; onOpen: (s: Shot, list: Shot[]) => void; onUpdated: (s: Shot | Shot[]) => void; save: SaveState; onRetry: () => void; error: string | null }

function Editor({ timeline: t, at, shots, presets, mask, onChange, onDelete, onOpen, onUpdated, save, onRetry, error }: EditorProps) {
  const byId = useMemo(() => new Map(shots.map((s) => [s.id, s])), [shots]);
  const clips = useMemo(() => resolveClips(t, byId), [t, byId]);
  const total = clips.reduce((a, c) => a + c.clip.duration_ms, 0);
  const cut = useCut(clips);
  const { cur } = cut;
  const [adding, setAdding] = useState(t.clips.length === 0);
  const [menu, setMenu] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);
  const durRef = useRef<HTMLInputElement>(null);
  const settings = useSettings();
  // Every change keeps the sequence blocks consistent (issue #37).
  const change = (next: Timeline) => onChange(normalizeGroups(next));
  const inline = useClipEditing({ timeline: t, clips, presets, onChange: change });
  const guardedCut = guardCut(cut, inline, settings.inlinePlayhead);
  const edit = (kind: EditKind, c: ResolvedClip) => { cut.select(c.clip.id); setAdding(false); inline.start(kind, c); };
  useCutUrl("timeline", t.id, clips, cut, inline.editing?.kind ?? null, edit, at);
  const latest = useRef(t); latest.current = t;
  const clipMenu = useCtxMenu<ResolvedClip>();
  const decide = (s: Shot, to: Shot["state"]) => void setShotState(s, to, onUpdated);

  const setClips = (list: TimelineClip[]) => change({ ...t, clips: list });
  const update = (id: string, patch: Partial<TimelineClip>) => setClips(t.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const move = (c: ResolvedClip, d: number) => setClips(stepUnit(t.clips, c.clip.id, d));
  /** `index` counts rendered clips; map it into the stored list (dead clips are skipped in render). */
  const reorder = (clipId: string, index: number) => setClips(moveUnitTo(t.clips, clipId, index >= clips.length ? t.clips.length : t.clips.indexOf(clips[index].clip)));
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
  const addShots = (list: Shot[]) => {
    let next = t, first: string | null = null;
    for (const s of list) { const r = insertShot(next, s, mask); next = r.t; first ??= r.first; }
    change(next);
    if (!cur && first) cut.select(first);
  };
  const addPlaceholder = () => { const p = newPlaceholder("Placeholder"); setClips([...t.clips, p]); cut.select(p.id); };
  const open = (c: ResolvedClip) => { if (c.kind === "photo") onOpen(c.shot, shotList); };
  const shotList = [...new Map(clips.flatMap((c) => (c.kind === "photo" ? [[c.shot.id, c.shot] as const] : []))).values()];

  useKeys({
    ArrowRight: () => cut.step(1),
    ArrowLeft: () => cut.step(-1),
    Home: () => clips[0] && cut.select(clips[0].clip.id),
    End: () => clips.at(-1) && cut.select(clips.at(-1)!.clip.id),
    " ": cut.toggle,
    "Alt+ArrowRight": () => { if (cur) move(cur, 1); },
    "Alt+ArrowLeft": () => { if (cur) move(cur, -1); },
    Delete: () => { if (cur) removeClip(cur); },
    d: () => durRef.current?.focus(),
    n: () => setAdding((a) => !a),
    p: addPlaceholder,
    r: () => { if (afterG()) return false; if (cur?.kind === "photo") edit("reframe", cur); },
    c: () => { if (afterG()) return false; if (cur) edit(cur.kind === "photo" ? "overlay" : "sketch", cur); },
    Enter: () => { if (cur) open(cur); },
  }, !inline.editing);

  return (
    <>
      <div class="f-scroll tl-main">
        <div class="plan-day" style={{ gap: "14px" }}>
          {error && <Banner role="alert" icon="cloud-alert" title="Not saved" meta={`${error}. Your changes are kept here; they save on retry or on the next edit.`} action={<Button kind="secondary" size="sm" onClick={onRetry}>Retry</Button>} />}
          <div class="plan-head">
            <Field label="Name" style={{ flex: 1, minWidth: "220px" }}><Input value={t.name} maxLength={120} style={{ fontWeight: 700 }} onInput={(e) => onChange({ ...t, name: (e.target as HTMLInputElement).value || "Untitled" })} /></Field>
            <Field label="Length"><span class="f-input num" style={{ fontWeight: 700, padding: "0 10px", display: "inline-flex", alignItems: "center" }}>{clock(total)} · {clips.length} clip{clips.length === 1 ? "" : "s"}</span></Field>
            <Field label="Presentation" as="div"><LockSelect value={t.lock_mode} onChange={(m) => onChange({ ...t, lock_mode: m })} /></Field>
            <CutDecision clips={clips} onUpdated={onUpdated} />
            <div class="plan-head__status">
              <SaveStatus state={save} onRetry={onRetry} />
              <div class="menu-anchor">
                <IconButton icon="dots-horizontal" label="Timeline menu" aria-expanded={menu} onClick={() => setMenu(!menu)} />
                {menu && <Popover right onClose={() => setMenu(false)}><MenuItem icon="delete-outline" danger onClick={() => { setMenu(false); onDelete(); }}>Delete timeline…</MenuItem></Popover>}
              </div>
            </div>
          </div>

          <CutPreview cut={guardedCut} clips={clips} total={total} lock={t.lock_mode} stage={inline.stage} editing={!!inline.editing}>
            <Button kind="secondary" size="sm" icon="image-off-outline" kbd="P" disabled={!!inline.editing} onClick={addPlaceholder}>Placeholder</Button>
            <Button kind={adding ? "secondary" : "primary"} size="sm" icon="plus" kbd="N" aria-pressed={adding} disabled={!!inline.editing} onClick={() => setAdding(!adding)}>Add shots</Button>
          </CutPreview>

          <Strip clips={clips} cut={guardedCut} stripRef={stripRef} lock={t.lock_mode} editingId={inline.editing?.clipId ?? null} onOpen={open} onReorder={reorder} onContext={(c, e) => clipMenu.openMenu(e, c)} />
        </div>
      </div>
      {clipMenu.menu && <ClipMenu menu={clipMenu.menu} onClose={clipMenu.closeMenu} onEdit={edit} onOpen={open} onDuplicate={(c) => void duplicate(c)} onRemove={removeClip} onState={decide} />}
      {inline.panel ?? (adding ? <AddPanel shots={shots} mask={mask} onAdd={addShots} onClose={() => setAdding(false)} />
        : cur && <ClipPanel key={cur.clip.id} c={cur} count={clips.length} lock={t.lock_mode} durRef={durRef} onUpdate={(p) => update(cur.clip.id, p)} onMove={(d) => move(cur, d)} onRemove={() => removeClip(cur)} onDuplicate={() => void duplicate(cur)} onOpen={() => open(cur)}
            onReframe={() => edit("reframe", cur)} onOverlay={() => edit("overlay", cur)} onSketch={() => edit("sketch", cur)}
            onState={cur.kind === "photo" ? (to) => decide(cur.shot, to) : undefined}
            onGroup={(g) => change(setGroup(t, g))} onUngroup={() => cur.clip.group_id && change(ungroup(t, cur.clip.group_id))}
            onRestore={() => cur.kind === "photo" && cur.clip.group_id && change(restorePhotos(t, cur.clip.group_id, cur.shot, mask))} />)}
    </>
  );
}

function AddPanel({ shots, mask, onAdd, onClose }: { shots: Shot[]; mask: MaskMode; onAdd: (s: Shot[]) => void; onClose: () => void }) {
  const [location, setLocation] = useState("");
  const [onlyApproved, setOnlyApproved] = useState(true);
  const pool = shots.filter((s) => !onlyApproved || s.state === "approved");
  const candidates = pool.filter((s) => !location || (s.location_id ?? "none") === location);
  const locations = [...new Map(shots.map((s) => [s.location_id ?? "none", s.location_name ?? "No location"])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const byLocation = new Map<string, Shot[]>();
  for (const s of candidates) { const k = s.location_name ?? "No location"; byLocation.set(k, [...(byLocation.get(k) ?? []), s]); }
  useKeys({ Escape: onClose });
  return (
    <Panel label="Add shots" width="340px" resize={DRAWER_RESIZE}>
      <PanelHead title="Add shots"><Kbd>N</Kbd><IconButton icon="close" label="Close" onClick={onClose} /></PanelHead>
      <div class="panel-filters">
        <Select label="Location" icon="map-marker-outline" value={location} onChange={setLocation} options={[{ value: "", label: "All locations" }, ...locations.map(([id, name]) => ({ value: id, label: name }))]} />
        <Checkbox checked={onlyApproved} role="checkbox" aria-checked={onlyApproved} onClick={() => setOnlyApproved(!onlyApproved)}>Approved only <span class="meta">· {pool.length} shots</span></Checkbox>
      </div>
      <PanelBody style={{ gap: "14px" }}>
        <span class="meta">A shot can be added more than once. A sequence adds one clip per photo.</span>
        {candidates.length === 0 && <span class="meta">Nothing to add{onlyApproved ? ": untick “Approved only” to see every shot." : "."}</span>}
        {[...byLocation.entries()].map(([name, list]) => (
          <div key={name} class="add-group">
            <div class="add-group__head"><strong class="ellipsis">{name}</strong><span class="meta">{list.length}</span><Button kind="ghost" size="sm" onClick={() => onAdd(list)}>Add all</Button></div>
            {list.map((s) => (
              <ListRow key={s.id} class="add-row" tooltip="Add to the timeline" onClick={() => onAdd([s])}
                thumb={<div class="f-row__thumb" style={{ width: "56px" }}><Framed photo={cover(s)} mode={mask} /></div>}
                title={shotTitle(s)} meta={<>{s.photos.length > 1 ? `${s.photos.length} photos · ` : ""}{s.overlays.length ? `${s.overlays.length} overlay${s.overlays.length === 1 ? "" : "s"}` : "no overlays"}</>}
                trailing={<Icon name="plus" size={20} />} />
            ))}
          </div>
        ))}
      </PanelBody>
    </Panel>
  );
}
