import { useMemo } from "preact/hooks";
import { AppIcon, CommandPalette, type PaletteItem } from "@openclapper/design";
import type { FileRec } from "../api";
import { appDef, apps, launch } from "../apps/registry";
import * as store from "../files";
import { kindOf, lookOf } from "../fileKinds";
import * as ops from "../fileOps";
import { thumbOf } from "../photoParts";
import * as wm from "./wm";

/** Results per group: the newest files first, so an empty query shows the recent ones. */
const LIMIT = 40;

/**
 * The desktop's search (⌘K, #426): every file of the project and of the account home, by name and
 * property values, with its picture and where it is; the apps; the open windows. Search only: no
 * actions and no project switching (the taskbar has those). The matched part of a name is marked.
 */
export function Search({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const project = store.useRoot({ project: projectId });
  const home = store.useRoot("home");
  const windows = wm.useWindows();
  const files = project.files ?? [];
  const homeFiles = home.files ?? [];
  const byId = useMemo(() => store.byId([...files, ...homeFiles]), [project.files, home.files]);

  const where = (f: FileRec, inHome: boolean) => {
    const path = store.pathOf(inHome ? homeFiles : files, f.container).map((x) => x.name);
    return `${kindOf(f.type).label} · ${[inHome ? "Home" : "Project", ...path].join(" › ")}`;
  };
  const fileItem = (f: FileRec, inHome: boolean): PaletteItem => {
    const l = lookOf(f, byId);
    const thumb = thumbOf(f, inHome ? homeFiles : files);
    const values = Object.values(f.values ?? {}).map((v) => (Array.isArray(v) ? v.join(" ") : String(v))).join(" ");
    return { id: `file-${f.id}`, group: "Files", label: f.name, meta: where(f, inHome), keywords: values, art: thumb ? <img src={thumb} alt="" loading="lazy" /> : <AppIcon glyph={l.glyph} color={l.color} size={24} /> };
  };
  const items: PaletteItem[] = useMemo(() => {
    const listed = (list: FileRec[]) => list.filter((f) => !f.internal_of && !f.fixed && f.type !== "preferences").sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at));
    return [
      ...windows.map((w): PaletteItem => { const d = appDef(w.app); return { id: `win-${w.id}`, group: "Open windows", label: w.title, meta: d?.name, art: <AppIcon glyph={d?.glyph} color={d?.color} size={24} /> }; }),
      ...apps().map((a): PaletteItem => ({ id: `app-${a.id}`, group: "Apps", label: a.name, meta: a.about, art: <AppIcon glyph={a.glyph} color={a.color} size={24} /> })),
      ...[...listed(files).map((f) => fileItem(f, false)), ...listed(homeFiles).map((f) => fileItem(f, true))],
    ];
  }, [windows, project.files, home.files]);

  const select = (id: string) => {
    onClose();
    if (id.startsWith("app-")) launch({ app: id.slice(4) });
    else if (id.startsWith("win-")) wm.focus(id.slice(4));
    else { const f = byId.get(id.slice(5)); if (f) ops.openFile(f, byId); }
  };
  return <div data-overlay><CommandPalette fixed large limit={LIMIT} items={items} placeholder="Search files, apps and windows" onClose={onClose} onSelect={select} /></div>;
}
