import { useCallback, useEffect, useMemo, useState } from "react";
import { cameraLabel, extraSummary, label, lightLabel, SHOT_STATES, type ShotState } from "@openclapper/vocab";
import { api, cover, type Photo, type Shot } from "./api";
import { queuedShots, withEdits } from "./localShots";
import { isOfflineMode } from "./net";
import { offlineDays, offlineProject, saveProjectOffline } from "./offline";
import { onEditsChange, onPendingChange, store } from "./storage";
import { onUploaded } from "./uploads";

/** "queued" = still on the phone (in the upload queue), whatever its review state. */
export type StateFilter = ShotState | "all" | "queued";
export const STATE_FILTERS: readonly StateFilter[] = ["all", ...SHOT_STATES, "queued"];
export const applyFilter = (shots: readonly Shot[] | null, f: StateFilter): Shot[] =>
  (shots ?? []).filter((s) => f === "all" || (f === "queued" ? !!s.queued : s.state === f));

/** Newest first, as every list on the phone shows them. */
const newestFirst = (a: Shot, b: Shot) => b.captured_at.localeCompare(a.captured_at);

/** What the phone has of a project without the server: the offline project copy, else shots of offline days. */
function storedShots(projectId: string): Shot[] {
  const kept = offlineProject(projectId);
  if (kept) return kept.shots;
  const seen = new Map<string, Shot>();
  for (const d of offlineDays()) if (d.day.project_id === projectId) for (const s of d.shots) seen.set(s.id, s);
  return [...seen.values()];
}

/** Where the list came from: the server, the copy on the phone (offline), or nothing yet. */
export type ShotsSource = "server" | "phone" | null;

/**
 * Shots of the active project, as every tab shows them: the server's list (or, when it can't be
 * reached, what is stored on the phone), plus the queued shots, with edits that still wait for
 * the server applied. Re-merges whenever the queue or the waiting edits change.
 */
export function useShots(projectId: string | null) {
  const [server, setServer] = useState<Shot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [local, setLocal] = useState(0);
  const load = useCallback(async () => {
    if (!projectId) { setServer([]); return; }
    if (isOfflineMode()) { setError("offline mode is on"); return; }
    setRefreshing(true);
    try {
      const list = await api.listShots(projectId);
      setServer(list);
      setError(null);
      // A project kept on the phone follows the server in the background (new photos only).
      const kept = offlineProject(projectId);
      if (kept) void saveProjectOffline(projectId, kept.projectName, list).catch(() => {});
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setRefreshing(false); }
  }, [projectId]);
  // A project switch changes `load`: drop the old project's list right away.
  useEffect(() => { setServer(null); setError(null); void load(); }, [load]);
  useEffect(() => {
    const offs = [
      onEditsChange(() => setLocal((n) => n + 1)),
      onPendingChange(() => setLocal((n) => n + 1)),
      // A shot left the queue: take the server's copy in place (no reload per upload).
      onUploaded((shot) => {
        if (shot.project_id !== projectId) return;
        setServer((cur) => (cur ? [shot, ...cur.filter((s) => s.id !== shot.id)] : cur));
      }),
    ];
    return () => { for (const off of offs) off(); };
  }, [projectId]);
  // Showing the phone's copy and an upload just went through: the server is back, load its list.
  useEffect(() => onUploaded(() => { if (!server && !isOfflineMode()) void load(); }), [server, load]);

  const source: ShotsSource = server ? "server" : error && projectId ? "phone" : null;
  const shots = useMemo(() => {
    if (!projectId) return server;
    const base = server ?? (error ? storedShots(projectId) : null);
    if (!base) return null;
    const edits = store.loadEdits();
    const queued = queuedShots(projectId);
    const ids = new Set(queued.map((s) => s.id));
    return [...queued, ...base.filter((s) => !ids.has(s.id)).map((s) => withEdits(s, edits))].sort(newestFirst);
  }, [server, error, projectId, local]);

  const remove = useCallback((id: string) => setServer((cur) => (cur ? cur.filter((s) => s.id !== id) : cur)), []);
  // Queued shots come from the queue itself; only server copies are replaced here.
  const update = useCallback((shot: Shot) => { if (!shot.queued) setServer((cur) => (cur ? cur.map((s) => (s.id === shot.id ? shot : s)) : cur)); setLocal((n) => n + 1); }, []);
  return { shots, source, error, refreshing, load, remove, update };
}
export type ShotsData = ReturnType<typeof useShots>;

export function rigLabel(p: Photo): string {
  if (p.source === "upload") return "Uploaded image";
  if (p.source === "drawn") return "Drawn sketch";
  const f = p.framing ?? {};
  const name = p.preset_name ?? (f.preset_name as string | undefined) ?? "unknown rig";
  const sb = f.speedbooster_factor as number | undefined;
  return `${name} · ${p.lens_mm} mm${sb && sb !== 1 ? ` ×${sb}` : ""}`;
}
/** "Name" or, for shots without tags, the rig label. */
export const shotTitle = (s: Shot): string => s.name?.trim() || rigLabel(cover(s));
/** Location name or "" for untagged shots. */
export const placeLabel = (s: Shot): string => [s.location_name, s.spot_name].filter(Boolean).join(" · ");
/** "EXT · Dusk / Night + Artificial · Partly cloudy · WS · Steadicam" (fixed tags only). */
export const tagsLabel = (s: { int_ext: string | null; light: string[]; artificial: boolean; weather: string | null; shot_size?: string | null; camera_support?: string | null; movement?: string[] }): string =>
  [label(s.int_ext), lightLabel(s.light, s.artificial), label(s.weather), cameraLabel({ shot_size: s.shot_size ?? null, camera_support: s.camera_support ?? null, movement: s.movement ?? [] })].filter(Boolean).join(" · ");
/** The project's extra fields as one line, with their labels. */
export const extraLine = (s: Shot): string => extraSummary(store.fieldsForProject(s.project_id), s.extra);
/** "3 photos" for sequences, "" for single shots. */
export const photoCountLabel = (s: Shot): string => (s.photos.length > 1 ? `${s.photos.length} photos` : "");

export function fovLabel(p: Photo): string {
  const f = p.framing ?? {};
  const parts: string[] = [];
  if (typeof f.full_frame_equivalent_mm === "number") parts.push(`${f.full_frame_equivalent_mm} mm FF-eq`);
  if (typeof f.hfov_deg === "number" && typeof f.vfov_deg === "number") parts.push(`${f.hfov_deg}° × ${f.vfov_deg}°`);
  return parts.join(" · ");
}

/** "Fri 2 Oct 18:42" */
export const shortTime = (iso: string) =>
  new Date(iso).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const hhmm = (d: Date | string) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
