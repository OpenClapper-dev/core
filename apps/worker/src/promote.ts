import { MAX_FRAMING_NAME, validateFrame, withCentre, type Frame, type Presentation } from "@openclapper/vocab";
import { assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import type { Ctx } from "./index.ts";
import { loadShot } from "./shots.ts";
import { assertAccess } from "./tenancy.ts";
import { withClips, type TimelineRow } from "./timelines.ts";

/**
 * Promotion (issue #31): what a timeline clip changed for itself becomes the shot's.
 *   - framing: the clip's own re-frame becomes a saved framing of its photo (an identical one is
 *     linked instead of duplicated); the clip then points at it.
 *   - layer: one of the clip's own layers becomes a layer of the shot, on the clip's step (or on
 *     every step when the clip has none); the clip shows it from its step from then on.
 *   - sketch: the clip's own sketch becomes a sketch of a shot in the project. That is a sketch
 *     clip's sketch, or (`sketch_id`) the one a clip kept after a shot filled its spot.
 * The clip must be saved (the timeline autosaves); the response carries both sides.
 */

interface Clip { id: string; photo_id: string | null; step_id: string | null; presentation: string | null; sketch_id: string | null }
const EPS = 1e-4;
const sameFrame = (a: Frame, b: Frame) => {
  const x = withCentre(a), y = withCentre(b);
  return Math.abs(x.width_fraction - y.width_fraction) < EPS && Math.abs(x.height_fraction - y.height_fraction) < EPS && Math.abs(x.x - y.x) < EPS && Math.abs(x.y - y.y) < EPS;
};

export function registerPromote(r: Router<Ctx>) {
  /** JSON { what: "framing" | "layer" | "sketch", name? (framing), layer_id (layer), shot_id? + sketch_id? (sketch) }. Returns { timeline, shot }. */
  r.on("POST", "/api/timelines/:id/clips/:clip/promote", async (ctx, { id, clip }) => {
    const { env, request } = ctx;
    const tid = assertUuid(id, "id");
    const cid = assertUuid(clip, "clip");
    // Everything promoted stays in the timeline's project (checked per kind below), so one check covers it.
    await assertAccess(ctx, "timeline", tid, "editor");
    const b = await readJson<Record<string, unknown>>(request);
    const t = await env.DB.prepare("SELECT * FROM timelines WHERE id = ?1").bind(tid).first<TimelineRow>();
    if (!t) throw new HttpError(404, "timeline not found");
    const c = await env.DB.prepare("SELECT id, photo_id, step_id, presentation, sketch_id FROM timeline_clips WHERE id = ?1 AND timeline_id = ?2").bind(cid, tid).first<Clip>();
    if (!c) throw new HttpError(404, "clip not found (is the timeline saved?)");
    const now = new Date().toISOString();
    let shotId: string;

    if (b.what === "framing") {
      if (!c.photo_id || !c.presentation) throw new HttpError(400, "only a photo clip has a framing");
      const pres = JSON.parse(c.presentation) as Presentation;
      if (pres.framing_id) throw new HttpError(409, "the clip already uses a saved framing");
      if (!pres.frame || validateFrame(pres.frame)) throw new HttpError(400, "the clip has no frame of its own");
      const photo = await env.DB.prepare("SELECT shot_id, lens_mm FROM photos WHERE id = ?1").bind(c.photo_id).first<{ shot_id: string; lens_mm: number }>();
      if (!photo) throw new HttpError(404, "photo not found");
      shotId = photo.shot_id;
      const rig = pres.rig_id ?? null;
      const lens = pres.lens_mm ?? photo.lens_mm;
      if (!(lens >= 1)) throw new HttpError(400, "the clip's frame has no lens");
      const frame = withCentre(pres.frame as Frame);
      const existing = (await env.DB.prepare("SELECT id, name, rig_id, lens_mm, frame FROM framings WHERE photo_id = ?1").bind(c.photo_id).all<{ id: string; name: string; rig_id: string | null; lens_mm: number; frame: string }>()).results
        .find((f) => (f.rig_id ?? null) === rig && Math.abs(f.lens_mm - lens) < EPS && sameFrame(JSON.parse(f.frame) as Frame, frame));
      let fid: string, name: string;
      if (existing) { fid = existing.id; name = existing.name; } else {
        fid = crypto.randomUUID();
        name = b.name === undefined || b.name === null || b.name === "" ? (pres.label ?? `From ${t.name}`).slice(0, MAX_FRAMING_NAME) : assertString(b.name, "name", MAX_FRAMING_NAME);
        const position = (await env.DB.prepare("SELECT coalesce(max(position), -1) + 1 AS p FROM framings WHERE photo_id = ?1").bind(c.photo_id).first<{ p: number }>())?.p ?? 0;
        await env.DB.prepare("INSERT INTO framings (id, photo_id, name, rig_id, lens_mm, frame, position, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
          .bind(fid, c.photo_id, name, rig, lens, JSON.stringify(frame), position, now).run();
      }
      const next: Presentation = { ...pres, frame, framing_id: fid, label: name };
      await env.DB.prepare("UPDATE timeline_clips SET presentation = ?1 WHERE id = ?2").bind(JSON.stringify(next), cid).run();
    } else if (b.what === "layer") {
      const layerId = assertUuid(b.layer_id, "layer_id");
      const l = await env.DB.prepare("SELECT shot_id, timeline_id, clip_id FROM layers WHERE id = ?1").bind(layerId).first<{ shot_id: string; timeline_id: string | null; clip_id: string | null }>();
      if (!l || l.timeline_id !== tid || l.clip_id !== cid) throw new HttpError(409, "the layer is not this clip's own");
      shotId = l.shot_id;
      const position = (await env.DB.prepare("SELECT coalesce(max(position), -1) + 1 AS p FROM layers WHERE shot_id = ?1 AND timeline_id IS NULL").bind(shotId).first<{ p: number }>())?.p ?? 0;
      await env.DB.prepare("UPDATE layers SET timeline_id = NULL, clip_id = NULL, range = ?1, position = ?2, updated_at = ?3 WHERE id = ?4")
        .bind(c.step_id ? JSON.stringify([c.step_id]) : null, Math.min(position, 1000), now, layerId).run();
    } else if (b.what === "sketch") {
      const sketchId = b.sketch_id === undefined || b.sketch_id === null ? c.sketch_id : assertUuid(b.sketch_id, "sketch_id");
      if (!sketchId) throw new HttpError(400, "the clip has no sketch");
      shotId = assertUuid(b.shot_id, "shot_id");
      const shot = await env.DB.prepare("SELECT project_id FROM shots WHERE id = ?1").bind(shotId).first<{ project_id: string }>();
      if (!shot || shot.project_id !== t.project_id) throw new HttpError(400, "the shot is not in the timeline's project");
      const k = await env.DB.prepare("SELECT timeline_id, clip_id FROM sketches WHERE id = ?1").bind(sketchId).first<{ timeline_id: string | null; clip_id: string | null }>();
      if (!k || k.timeline_id !== tid || k.clip_id !== cid) throw new HttpError(409, "the sketch is not this clip's own");
      const position = (await env.DB.prepare("SELECT coalesce(max(position), -1) + 1 AS p FROM sketches WHERE shot_id = ?1").bind(shotId).first<{ p: number }>())?.p ?? 0;
      await env.DB.prepare("UPDATE sketches SET shot_id = ?1, timeline_id = NULL, clip_id = NULL, position = ?2, updated_at = ?3 WHERE id = ?4").bind(shotId, position, now, sketchId).run();
    } else throw new HttpError(400, "what must be framing, layer or sketch");

    await env.DB.prepare("UPDATE timelines SET updated_at = ?1 WHERE id = ?2").bind(now, tid).run();
    const row = (await env.DB.prepare("SELECT * FROM timelines WHERE id = ?1").bind(tid).first<TimelineRow>())!;
    return json({ timeline: (await withClips(env, [row]))[0], shot: await loadShot(env, shotId) });
  });
}
