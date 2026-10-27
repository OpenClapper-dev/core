import { useEffect, useState } from "preact/hooks";
import { promoteClip, type Layer, type Photo, type Shot, type Sketch, type Timeline, type TimelineClip } from "./api";
import { ownReframe } from "./TimelineParts";
import { Framed } from "./Framed";
import { invalidateTimelines, projectTimelines } from "./Inspector";
import { Button, Icon, Popover, promptDialog, toast } from "@openclapper/ui";

/**
 * "From timelines" (issues #31, #275): what timeline clips changed for themselves on this photo or
 * shot — their own re-frames, layers and sketches — with the action that makes it the shot's. The clip
 * then points at the shot's copy; nothing is duplicated (an identical saved framing is linked).
 */

type Item =
  | { kind: "framing"; t: Timeline; clip: TimelineClip; index: number }
  | { kind: "layer"; t: Timeline; layer: Layer; index: number }
  | { kind: "sketch"; t: Timeline; sketch: Sketch; index: number };

const clipIndex = (t: Timeline, clipId: string | null | undefined) => t.clips.findIndex((c) => c.id === clipId);

function itemsOf(all: Timeline[], photo: Photo, kinds: Item["kind"][]): Item[] {
  const out: Item[] = [];
  for (const t of all) {
    if (kinds.includes("framing")) t.clips.forEach((clip, index) => { if (clip.photo_id === photo.id && clip.presentation && ownReframe(clip.presentation)) out.push({ kind: "framing", t, clip, index }); });
    if (kinds.includes("layer")) for (const layer of t.layers) if (layer.shot_id === photo.shot_id) out.push({ kind: "layer", t, layer, index: clipIndex(t, layer.clip_id) });
    if (kinds.includes("sketch")) for (const sketch of t.sketches) out.push({ kind: "sketch", t, sketch, index: clipIndex(t, sketch.clip_id) });
  }
  return out;
}

export function FromTimelines({ shot, photo, kinds, onUpdated }: { shot: Shot; photo: Photo; kinds: Item["kind"][]; onUpdated: (s: Shot) => void }) {
  const [all, setAll] = useState<Timeline[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => { void projectTimelines(shot.project_id).then(setAll); };
  useEffect(load, [shot.project_id, shot.id]);
  const items = all ? itemsOf(all, photo, kinds) : [];
  if (!items.length) return null;

  async function promote(it: Item) {
    const key = itemKey(it);
    setBusy(key);
    try {
      let r: { timeline: Timeline; shot: Shot };
      if (it.kind === "framing") {
        const name = await promptDialog({ title: "Save as a framing of the photo", input: { label: "Name", value: it.clip.presentation?.label ?? `From ${it.t.name}` }, confirmLabel: "Save framing" });
        if (!name) return;
        r = await promoteClip(it.t.id, it.clip.id, { what: "framing", name });
        const linked = r.timeline.clips.find((c) => c.id === it.clip.id)?.presentation?.label;
        toast(linked && linked !== name ? `Linked to the existing framing “${linked}”` : `Saved framing “${name}”; the clip uses it now`);
      } else if (it.kind === "layer") {
        r = await promoteClip(it.t.id, it.layer.clip_id!, { what: "layer", layer_id: it.layer.id });
        toast(`“${it.layer.name}” is now a layer of the shot, on the clip's step`);
      } else {
        r = await promoteClip(it.t.id, it.sketch.clip_id!, { what: "sketch", shot_id: shot.id, sketch_id: it.sketch.id });
        toast(`“${it.sketch.name}” is now a sketch of this shot`);
      }
      onUpdated(r.shot);
      invalidateTimelines(shot.project_id);
      load();
    } catch (e) { toast(`Failed: ${(e as Error).message}`, "danger"); } finally { setBusy(null); }
  }

  return (
    <div class="menu-anchor">
      <Button kind="secondary" size="sm" icon="filmstrip" aria-expanded={open} title="Re-frames, layers and sketches made in this project's timelines" onClick={() => setOpen(!open)}>From timelines · {items.length}</Button>
      {open && (
        <Popover right onClose={() => setOpen(false)}>
          <div class="fromtl">
            <span class="meta fromtl__intro">Made inside timelines; they belong to their clip until you make them the shot's. The clip then uses the shot's.</span>
            {items.map((it) => (
              <div key={itemKey(it)} class="fromtl__row">
                <div class="fromtl__thumb">
                  {it.kind === "framing" ? <Framed photo={photo} mode="mask" frame={it.clip.presentation?.frame ?? null} />
                    : it.kind === "sketch" && it.sketch.render_url ? <img src={it.sketch.render_url} alt="" />
                    : <Icon name={it.kind === "layer" ? (it.layer.kind === "drawing" ? "draw" : "tune-variant") : "floor-plan"} />}
                </div>
                <div class="fromtl__txt">
                  <strong class="ellipsis">{it.kind === "framing" ? it.clip.presentation?.label ?? "Re-frame" : it.kind === "layer" ? it.layer.name : it.sketch.name}</strong>
                  <span class="meta ellipsis">{it.kind === "framing" ? "Re-frame" : it.kind === "layer" ? "Layer" : "Sketch"} · {it.t.name}{it.index >= 0 ? ` · clip ${it.index + 1}` : ""}</span>
                </div>
                <Button kind="secondary" size="sm" disabled={busy === itemKey(it)} onClick={() => void promote(it)}>{it.kind === "sketch" ? "Attach here" : "Make the shot's"}</Button>
              </div>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
}

const itemKey = (it: Item) => `${it.kind}:${it.t.id}:${it.kind === "framing" ? it.clip.id : it.kind === "layer" ? it.layer.id : it.sketch.id}`;
