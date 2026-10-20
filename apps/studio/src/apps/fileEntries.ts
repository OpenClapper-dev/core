import { useEffect, useMemo, useState } from "preact/hooks";
import { FILE_TYPE_META, type FileResourceType } from "@openclapper/vocab";
import type { DesktopItem, Photo, ShootingDay, Timeline } from "../api";
import * as data from "../data";
import { cover, shotTitle } from "../format";
import { projectDays, projectTimelines } from "../Inspector";
import { clock } from "../TimelineParts";
import { APPS, launch, type AppId } from "./registry";

/** One file as Files and the desktop show it, built from the loaded collections (no list query of its own). */
export interface FileEntry {
  type: FileResourceType;
  id: string;
  name: string;
  /** The short facts under or beside the name. */
  sub: string;
  /** For sorting by date: captured, updated or the day's date. */
  date: string | null;
  archived?: boolean;
  thumb?: Photo;
}

const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The project's timelines and days for Files and the desktop icons (cached per project, the same
 * fetch the inspector uses). `refresh` re-reads them, e.g. when the Files window gains focus.
 */
export function useTimelinesDays(projectId: string, refreshKey: unknown) {
  const [tl, setTl] = useState<Timeline[]>([]);
  const [days, setDays] = useState<ShootingDay[]>([]);
  // Binned or restored (here, in the bin, by Undo): read them again.
  const [tick, setTick] = useState(0);
  useEffect(() => data.onTrash((e) => { if (e.projectId === projectId && (e.type === "timeline" || e.type === "day" || e.type === "folder")) setTick((n) => n + 1); }), [projectId]);
  useEffect(() => {
    let live = true;
    void projectTimelines(projectId).then((t) => live && setTl(t));
    void projectDays(projectId).then((d) => live && setDays(d));
    return () => { live = false; };
  }, [projectId, refreshKey, tick]);
  return { timelines: tl, days };
}

/** Every file of the active project, by type. */
export function useFileEntries(projectId: string, refreshKey?: unknown): Record<FileResourceType, FileEntry[]> {
  const pd = data.useProjectData(projectId);
  const { timelines, days } = useTimelinesDays(projectId, refreshKey);
  return useMemo(() => {
    const spotCount = new Map<string, number>();
    for (const sp of pd.spots) spotCount.set(sp.location_id, (spotCount.get(sp.location_id) ?? 0) + 1);
    return {
      shot: pd.scoped.map((s) => ({ type: "shot" as const, id: s.id, name: shotTitle(s), sub: [s.state === "unreviewed" ? "To review" : s.state === "approved" ? "Approved" : "Archived", plural(s.photos.length, "photo"), s.location_name].filter(Boolean).join(" · "), date: s.captured_at, archived: s.state === "archived", thumb: cover(s) })),
      timeline: timelines.map((t) => ({ type: "timeline" as const, id: t.id, name: t.name, sub: `${plural(t.clips.length, "clip")} · ${clock(t.clips.reduce((a, c) => a + c.duration_ms, 0))}`, date: t.updated_at ?? t.created_at })),
      day: days.map((d) => ({ type: "day" as const, id: d.id, name: `${dayLabel(d.date)}${d.title ? ` · ${d.title}` : ""}`, sub: plural(d.shots.length, "shot"), date: d.date })),
      view: pd.views.map((v) => ({ type: "view" as const, id: v.id, name: v.name, sub: plural(v.filter.rules.length, "rule"), date: v.updated_at ?? v.created_at })),
      location: pd.locations.map((l) => ({ type: "location" as const, id: l.id, name: l.name, sub: [plural(spotCount.get(l.id) ?? 0, "spot"), plural(l.shot_count, "shot"), l.lat !== null ? "pinned" : null].filter(Boolean).join(" · "), date: l.updated_at ?? l.created_at })),
      field: [...pd.fields].sort((a, b) => a.position - b.position).map((f) => ({ type: "field" as const, id: f.id, name: f.definition.label || f.definition.key, sub: `${f.definition.key} · ${f.definition.type} · #${f.position + 1}`, date: f.updated_at ?? f.created_at })),
    };
  }, [pd.scoped, pd.views, pd.locations, pd.spots, pd.fields, timelines, days]);
}

/** Open a file in the app that shows it (FILE_TYPE_META in vocab says which). */
export function openResource(type: FileResourceType, id: string) {
  switch (type) {
    case "shot": return launch({ app: "shot", resource: { type, id }, state: { stage: "photo", list: [id] } });
    case "timeline": return launch({ app: "timeline", state: { timelineId: id } });
    case "day": return launch({ app: "plan", state: { dayId: id } });
    case "view": return launch({ app: "gallery", state: { viewId: id } });
    case "location": case "field": return launch({ app: FILE_TYPE_META[type].app as AppId, state: { id } });
  }
}

/** Open what a desktop shortcut points at. */
export function openShortcut(d: DesktopItem) {
  if (d.kind === "app" && d.app_id) launch({ app: d.app_id });
  else if (d.kind === "folder" && d.folder_id) launch({ app: "files", state: { folderId: d.folder_id } });
  else if (d.resource_type && d.resource_id) openResource(d.resource_type, d.resource_id);
}

/** What a shortcut shows: its own label, else the live name; null when its target is gone (the icon is hidden). */
export function shortcutView(d: DesktopItem, entries: Record<FileResourceType, FileEntry[]>, folderName: (id: string) => string | null): { name: string; icon: string; thumb?: Photo; archived?: boolean } | null {
  if (d.kind === "app") { const a = d.app_id ? APPS[d.app_id] : undefined; return a ? { name: d.label ?? a.name, icon: a.icon } : null; }
  if (d.kind === "folder") { const n = d.folder_id ? folderName(d.folder_id) : null; return n === null ? null : { name: d.label ?? n, icon: "folder-outline" }; }
  const e = d.resource_type ? entries[d.resource_type].find((x) => x.id === d.resource_id) : undefined;
  return e && d.resource_type ? { name: d.label ?? e.name, icon: FILE_TYPE_META[d.resource_type].icon, thumb: e.thumb, archived: e.archived } : null;
}
