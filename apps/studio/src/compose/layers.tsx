/**
 * Editing a layer stack (epic #275), shared by the shot's Compose stage and a timeline clip's own
 * layers: the layers as local documents with their shapes, saved one by one a moment after the last
 * change (like the timeline's inline drawings), the list with the footage row, and the selected
 * layer's settings. Order is explicit: the list runs top to bottom with the footage in it, and
 * moving a layer past the footage puts it below the photo.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { byPosition, NEUTRAL_LOOK, type Layer, type LayerInput, type LayerKind, type Look } from "@openclapper/vocab";
import { deleteLayer, putLayer, type Shot } from "../api";
import { Button, cx, Icon, IconButton, Input, MarkdownField, Seg, toast, type SaveState } from "@openclapper/ui";
import { LookSection, Range } from "./editor";

export const FOOTAGE = "__footage__";
const SAVE_DELAY = 900;

export const toInput = (l: Layer): LayerInput => ({
  shot_id: l.shot_id, kind: l.kind, name: l.name.trim() || "Layer", description: l.description, position: l.position, visible: l.visible, locked: l.locked, opacity: l.opacity,
  space: l.space, photo_id: l.photo_id, range: l.range, shapes: l.kind === "drawing" ? l.shapes ?? [] : null, look: l.kind === "adjustment" ? l.look : null,
  timeline_id: l.timeline_id, clip_id: l.clip_id,
});

export interface LayerDocs {
  /** Bottom to top. */
  list: Layer[];
  loading: boolean;
  save: SaveState;
  update: (id: string, patch: Partial<Layer>) => void;
  /** A new layer on top (drawing: empty; adjustment: neutral look), saved at once. */
  add: (kind: LayerKind, base: Pick<Layer, "shot_id" | "space" | "photo_id" | "range" | "timeline_id" | "clip_id">) => Promise<Layer | null>;
  remove: (id: string) => Promise<void>;
  /** One slot up (+1, towards the top) or down (−1), the footage counting as a slot. */
  move: (id: string, d: 1 | -1) => void;
  /** Send what is pending now; resolves false when a save failed. */
  flush: () => Promise<boolean>;
  retry: () => void;
}

/**
 * The layers of one owner (a shot, or a clip). `load` gives them with shapes; every save hands the
 * server's answer to `onSaved` (the shot, for the shot's payload and the baker). `beforeSave` runs
 * first (the shot's steps must exist before a range names them).
 */
export function useLayerDocs({ load, deps, onSaved, onDeleted, beforeSave }: {
  load: () => Promise<Layer[]>; deps: unknown[];
  onSaved: (r: { layer: Layer; shot: Shot }) => void; onDeleted?: (id: string, shot: Shot) => void; beforeSave?: () => Promise<void>;
}): LayerDocs {
  const [list, setList] = useState<Layer[]>([]);
  const [loading, setLoading] = useState(true);
  const [save, setSave] = useState<SaveState>("idle");
  const listRef = useRef(list); listRef.current = list;
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));

  useEffect(() => {
    let live = true;
    setLoading(true);
    void load().then((l) => { if (live) { setList([...l].sort(byPosition)); setLoading(false); } }).catch((e: Error) => { if (live) { setLoading(false); toast(`Could not load the layers: ${e.message}`, "danger"); } });
    return () => { live = false; };
  }, deps);

  const send = (id: string): Promise<boolean> => (chain.current = chain.current.then(async () => {
    const l = listRef.current.find((x) => x.id === id);
    if (!l) return true;
    setSave("saving");
    try {
      await beforeSave?.();
      const r = await putLayer(id, toInput(l));
      setList((cur) => cur.map((x) => (x.id === id ? { ...x, updated_at: r.layer.updated_at, created_at: r.layer.created_at } : x)));
      onSaved(r);
      setSave(pending.current.size ? "dirty" : "saved");
      return true;
    } catch (e) {
      setSave("error");
      toast(`Layer not saved: ${(e as Error).message}`, "danger");
      return false;
    }
  }));
  const schedule = (id: string) => {
    setSave("dirty");
    const t = pending.current.get(id);
    if (t) clearTimeout(t);
    pending.current.set(id, setTimeout(() => { pending.current.delete(id); void send(id); }, SAVE_DELAY));
  };
  const flush = async () => {
    const ids = [...pending.current.keys()];
    for (const id of ids) { clearTimeout(pending.current.get(id)!); pending.current.delete(id); }
    const results = await Promise.all(ids.map(send));
    await chain.current;
    return results.every(Boolean);
  };
  // Leaving saves what is pending.
  useEffect(() => () => { for (const [id, t] of pending.current) { clearTimeout(t); void send(id); } pending.current.clear(); }, []);

  const update = (id: string, patch: Partial<Layer>) => { setList((cur) => cur.map((x) => (x.id === id ? { ...x, ...patch } : x))); listRef.current = listRef.current.map((x) => (x.id === id ? { ...x, ...patch } : x)); schedule(id); };
  const add: LayerDocs["add"] = async (kind, base) => {
    const top = listRef.current.reduce((m, l) => Math.max(m, l.position), -1);
    const n = listRef.current.filter((l) => l.kind === kind).length + 1;
    const l: Layer = {
      ...base, id: crypto.randomUUID(), kind, name: kind === "drawing" ? `Drawing ${n}` : `Adjustment ${n}`, description: null,
      position: Math.max(0, top + 1), visible: true, locked: false, opacity: 1, look: kind === "adjustment" ? { ...NEUTRAL_LOOK } : null,
      shapes: kind === "drawing" ? [] : undefined, created_at: new Date().toISOString(), updated_at: null,
    };
    setList((cur) => [...cur, l].sort(byPosition));
    listRef.current = [...listRef.current, l].sort(byPosition);
    return (await send(l.id)) ? l : null;
  };
  const remove = async (id: string) => {
    const t = pending.current.get(id);
    if (t) { clearTimeout(t); pending.current.delete(id); }
    try {
      const r = await deleteLayer(id);
      setList((cur) => cur.filter((x) => x.id !== id));
      onDeleted?.(id, r.shot);
    } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  };
  const move = (id: string, d: 1 | -1) => {
    // The stack bottom to top with the footage as a slot; swap, then renumber: below the footage
    // −n..−1, above it 0..m−1, and save the layers whose position changed.
    const below = listRef.current.filter((l) => l.position < 0), above = listRef.current.filter((l) => l.position >= 0);
    const slots: (Layer | typeof FOOTAGE)[] = [...below, FOOTAGE, ...above];
    const i = slots.findIndex((s) => s !== FOOTAGE && s.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= slots.length) return;
    [slots[i], slots[j]] = [slots[j], slots[i]];
    const f = slots.indexOf(FOOTAGE);
    const next = slots.flatMap((s, k) => (s === FOOTAGE ? [] : [{ ...s, position: k < f ? k - f : k - f - 1 }]));
    const changed = next.filter((l) => listRef.current.find((x) => x.id === l.id)!.position !== l.position);
    setList(next.sort(byPosition));
    listRef.current = next;
    for (const l of changed) schedule(l.id);
  };
  return { list, loading, save, update, add, remove, move, flush, retry: () => { for (const l of listRef.current) schedule(l.id); } };
}

/** The stack, top to bottom, with the footage row between the layers above and below it. */
export function LayerList({ docs, selected, onSelect, footage, badge }: {
  docs: LayerDocs; selected: string | null; onSelect: (id: string) => void;
  /** The footage row's label (the step on stage); null hides the row (a clip's own layers). */
  footage: string | null;
  /** A short note per layer: on which steps it shows. */
  badge?: (l: Layer) => string | null;
}) {
  const top = [...docs.list].reverse();
  const rows: (Layer | typeof FOOTAGE)[] = footage === null ? top : [...top.filter((l) => l.position >= 0), FOOTAGE, ...top.filter((l) => l.position < 0)];
  return (
    <ul class="layer-list" role="listbox" aria-label="Layers">
      {rows.map((r) => r === FOOTAGE ? (
        <li key={FOOTAGE} role="option" aria-selected={selected === FOOTAGE} class={cx("layer-row layer-row--footage", selected === FOOTAGE && "is-sel")} onClick={() => onSelect(FOOTAGE)}>
          <Icon name="image-outline" /><span class="layer-row__name">{footage}</span><span class="meta">footage</span>
        </li>
      ) : (
        <li key={r.id} role="option" aria-selected={selected === r.id} class={cx("layer-row", selected === r.id && "is-sel", !r.visible && "is-hidden")} onClick={() => onSelect(r.id)}>
          <IconButton icon={r.visible ? "eye-outline" : "eye-off-outline"} label={r.visible ? "Hide" : "Show"} title={r.visible ? "Hide" : "Show"} onClick={(e: MouseEvent) => { e.stopPropagation(); docs.update(r.id, { visible: !r.visible }); }} />
          <Icon name={r.kind === "drawing" ? "draw" : "tune-variant"} />
          <span class="layer-row__name ellipsis">{r.name}</span>
          {badge?.(r) && <span class="layer-row__badge">{badge(r)}</span>}
          {r.space === "photo" && <Icon name="image-filter-center-focus-weak" size={14} label="Anchored to a photo" />}
          {r.locked && <Icon name="lock-outline" size={14} label="Locked" />}
        </li>
      ))}
    </ul>
  );
}

/** The selected layer's settings: name, order, opacity, lock, space, then its look or its description. */
export function LayerProps({ layer, docs, range, space, children }: {
  layer: Layer; docs: LayerDocs;
  /** The range control (shots only). */
  range?: ComponentChildren;
  /** Switch between frame and photo space; null when it cannot change (a clip's layer on its photo). */
  space?: ((s: Layer["space"]) => void) | null;
  /** Shape section etc. (drawing layers). */
  children?: ComponentChildren;
}) {
  const set = (patch: Partial<Layer>) => docs.update(layer.id, patch);
  return (
    <>
      <div class="f-sec" style={{ gap: "10px" }}>
        <div class="f-formgrid">
          <label for="layer-name">Name</label>
          <Input sm id="layer-name" value={layer.name} maxLength={80} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
        </div>
        <Range label="Opacity" value={layer.opacity} min={0} max={1} onChange={(v) => set({ opacity: v })} />
        <div class="btn-row" style={{ gap: "6px", flexWrap: "wrap" }}>
          <IconButton kind="secondary" icon="arrow-up" label="Up in the stack" title="Up in the stack" onClick={() => docs.move(layer.id, 1)} />
          <IconButton kind="secondary" icon="arrow-down" label="Down in the stack" title="Down in the stack (past the footage: under the photo)" onClick={() => docs.move(layer.id, -1)} />
          <Button kind="secondary" size="sm" icon={layer.locked ? "lock-open-variant-outline" : "lock-outline"} onClick={() => set({ locked: !layer.locked })}>{layer.locked ? "Unlock" : "Lock"}</Button>
          <span class="grow" />
          <Button kind="danger" size="sm" icon="delete-outline" onClick={() => void docs.remove(layer.id)}>Delete</Button>
        </div>
        {layer.position < 0 && <span class="meta">Under the photo: it shows only where there is no picture (beyond the capture), and not on the phone.</span>}
        {space !== null && space && (
          <div class="f-field">
            <span class="f-field__label">Anchored to</span>
            <Seg label="Anchored to" value={layer.space} onChange={space} options={[{ id: "frame", label: "Frame", title: "Stays put in the frame on every step (zoom, pan)" }, { id: "photo", label: "Photo", title: "Sticks to the pixels of one photo; only on that photo's steps" }]} />
          </div>
        )}
        {range}
      </div>
      {layer.kind === "adjustment" && <LookSection look={layer.look ?? { ...NEUTRAL_LOOK }} onLook={(look: Look) => set({ look })} />}
      {children}
      <div class="f-sec">
        <div class="f-sec__head"><Icon name="text-long" />Description</div>
        <MarkdownField value={layer.description ?? ""} onChange={(v) => set({ description: v || null })} rows={4} placeholder="What this layer shows…" />
      </div>
    </>
  );
}
