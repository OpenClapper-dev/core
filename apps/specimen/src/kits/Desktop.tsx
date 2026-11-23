// Studio desktop specimen (export ui_kits/studio). Composes only design-system components.
import "./kits.css";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  Desktop, SnapGrip, AppWindow, Taskbar, TaskbarButton, TaskbarClock, Launcher, TaskView, FileTile, AppIcon, EnvMarker, Toolbar, ToolbarSpacer, StatusBar, SidebarNav, Breadcrumb, Button, SearchInput, Segmented, ThumbnailTile, PropertyList, PropertySection, PropertyRow, Table, ContextMenu, CommandPalette, Toast, SignIn, ProjectPicker,
  type AppWindowProps, type FileTileProps, type IconName,
} from "@openclapper/design";

type AppId = "files" | "inspector" | "table";
type WindowState = NonNullable<AppWindowProps["state"]>;
type Box = NonNullable<AppWindowProps["minimizeTarget"]>;
interface Win { id: AppId; x: number; y: number; w: number; h: number; state: WindowState | "closed"; target?: Box; closing?: boolean }

const APPS: Record<AppId, { title: string; glyph: IconName; color: number }> = {
  files: { title: "Files", glyph: "folder", color: 5 },
  inspector: { title: "Inspector", glyph: "lens", color: 6 },
  table: { title: "Locations", glyph: "pin", color: 3 },
};
const isApp = (id: string): id is AppId => Object.prototype.hasOwnProperty.call(APPS, id);
const appIcon = (k: AppId, s?: number) => <AppIcon glyph={APPS[k].glyph} color={APPS[k].color} size={s || 16} />;
const PH = () => <span style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg,#6a6a6a,#262626 70%)" }} />;

const load = (key: string, fallback: string) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const save = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage unavailable: keep in memory only */ } };

function FilesApp({ sel, setSel }: { sel: string[]; setSel: (s: string[]) => void }) {
  const [view, setView] = useState("grid");
  const [q, setQ] = useState("");
  const [nav, setNav] = useState("scouting");
  const names = ["IMG_0142", "IMG_0143", "IMG_0147", "IMG_0151", "IMG_0152", "IMG_0160", "IMG_0161", "IMG_0164"].filter((n) => n.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <Toolbar>
        <Button variant="quiet" size="sm" icon="chevron-left" label="Back" />
        <Breadcrumb items={[{ id: "p", label: "Harbour film" }, { id: "s", label: "Scouting" }]} />
        <ToolbarSpacer />
        <Segmented value={view} onChange={setView} label="View" options={[{ value: "grid", icon: "grid", title: "Grid" }, { value: "list", icon: "list", title: "List" }]} />
        <SearchInput size="sm" value={q} onChange={setQ} style={{ width: 130 }} />
        <Button size="sm" variant="primary" icon="upload">Import</Button>
      </Toolbar>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <SidebarNav style={{ width: 132, flex: "none", borderRight: "1px solid var(--border-divider)" }} value={nav} onChange={setNav}
          sections={[{ items: [{ id: "recent", label: "Recent", icon: "clock" }, { id: "scouting", label: "Scouting", icon: "folder", count: 24 }, { id: "photos", label: "Photos", icon: "image", count: 312 }, { id: "bin", label: "Recycle bin", icon: "trash", count: 3 }] }]} />
        {view === "grid"
          ? <div style={{ flex: 1, overflow: "auto", padding: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(104px,1fr))", gap: 10, alignContent: "start" }}>
              {names.map((n, i) => <ThumbnailTile key={n} name={n + ".jpg"} meta={[24, 35, 85, 50][i % 4] + " mm"} badges={i % 3 === 0 ? ["RAW"] : []} selected={sel.includes(n)}
                onClick={(e) => setSel(e.shiftKey || e.ctrlKey || e.metaKey ? (sel.includes(n) ? sel.filter((x) => x !== n) : sel.concat(n)) : [n])}><PH /></ThumbnailTile>)}
            </div>
          : <div style={{ flex: 1, overflow: "auto" }}>
              {names.map((n) => <FileTile key={n} kind="image" view="list" name={n + ".jpg"} meta="4.2 MB" selected={sel.includes(n)} onClick={() => setSel([n])} />)}
            </div>}
      </div>
    </>
  );
}

function InspectorApp({ sel }: { sel: string[] }) {
  return (
    <div style={{ overflow: "auto" }}>
      <PropertyList>
        <PropertySection title={sel.length ? sel.length === 1 ? sel[0] + ".jpg" : sel.length + " photos" : "Nothing selected"} icon="image">
          <PropertyRow label="Taken" value="12 Nov 2026 · 14:32:08" numeric />
          <PropertyRow label="Path" overflow="truncate" value={"/Harbour film/Scouting/" + (sel[0] || "IMG_0143") + ".jpg"} />
          <PropertyRow label="Size" value="6000 × 4000" numeric />
        </PropertySection>
        <PropertySection title="Optics" icon="lens">
          <PropertyRow label="Focal length" value="24" unit="mm" numeric />
          <PropertyRow label="Sensor" value="36 × 24" unit="mm" numeric />
          <PropertyRow label="Aperture" value="f/2.8" numeric />
        </PropertySection>
        <PropertySection title="Position" icon="pin">
          <PropertyRow label="Latitude" value="52.5200° N" numeric />
          <PropertyRow label="Longitude" value="13.4050° E" numeric />
          <PropertyRow label="Accuracy" value="±5" unit="m" numeric />
        </PropertySection>
      </PropertyList>
    </div>
  );
}

type Row = { id: string } & Record<string, string>;
type Sort = { key: string; dir: "asc" | "desc" };
const LOC: Row[] = [{ id: "a", name: "Harbour gate", lat: "53.5461", shots: "12" }, { id: "b", name: "Old brewery", lat: "53.5513", shots: "7" }, { id: "c", name: "Ferry ramp", lat: "53.5440", shots: "19" }, { id: "d", name: "Rooftop 4", lat: "53.5502", shots: "3" }];
function TableApp() {
  const [sel, setSel] = useState(["b"]);
  const [sort, setSort] = useState<Sort>({ key: "name", dir: "asc" });
  const rows = [...LOC].sort((x, y) => (x[sort.key] > y[sort.key] ? 1 : -1) * (sort.dir === "asc" ? 1 : -1));
  return <div style={{ overflow: "auto", flex: 1 }}><Table selectable sort={sort} onSort={setSort} selected={sel} onSelect={setSel} columns={[{ key: "name", label: "Name", sortable: true }, { key: "lat", label: "Lat °", numeric: true, sortable: true }, { key: "shots", label: "Shots", numeric: true, sortable: true }]} rows={rows} /></div>;
}

// Default placement: tile without overlap when the desktop is big enough (files top-left, locations below, inspector on the right);
// otherwise cascade by one title bar so every window's bar stays visible.
function initialWindows(): Win[] {
  const W = window.innerWidth, H = window.innerHeight - 40, x0 = 104, g = 12, top = 48;
  const iw = 260, lw = W - x0 - iw - g * 2, lh = H - g * 2;
  if (lw >= 440 && lh >= 440) {
    const fh = Math.round((lh - g) * 0.55);
    return [
      { id: "files", x: x0, y: g, w: lw, h: fh, state: "normal" },
      { id: "inspector", x: x0 + lw + g, y: top, w: iw, h: H - top - g, state: "normal" },
      { id: "table", x: x0, y: g + fh + g, w: lw, h: lh - fh - g, state: "normal" },
    ];
  }
  const s = 32, w = Math.min(560, W - x0 - g - s * 2), h = Math.min(360, H - g - s * 2);
  return [
    { id: "table", x: x0, y: g, w, h, state: "normal" },
    { id: "inspector", x: x0 + s, y: g + s, w: Math.min(300, w), h, state: "normal" },
    { id: "files", x: x0 + s * 2, y: g + s * 2, w, h, state: "normal" },
  ];
}

const DESK_ICONS: [string, FileTileProps["kind"], string][] = [["scouting", "folder", "Scouting"], ["ref", "image", "Ref_04.jpg"], ["notes", "file", "Call sheet.md"], ["bin", "bin", "Recycle bin"]];

function Studio({ theme, setTheme }: { theme: string; setTheme: (t: string) => void }) {
  const [wins, setWins] = useState<Win[]>(initialWindows);
  const [order, setOrder] = useState<AppId[]>(["table", "inspector", "files"]);
  const [sel, setSel] = useState(["IMG_0143", "IMG_0151"]);
  const [launcher, setLauncher] = useState(false);
  const [taskview, setTaskview] = useState(false);
  const [palette, setPalette] = useState(false);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [iconSel, setIconSel] = useState(["scouting"]);
  const [toast, setToast] = useState<string | null>(null);
  const [snapped, setSnapped] = useState(false);
  const drag = useRef<{ id: AppId; sx: number; sy: number; x: number; y: number } | null>(null);
  const focused = order[order.length - 1];
  const focus = (id: AppId) => setOrder((o) => o.filter((x) => x !== id).concat(id));
  const patch = (id: AppId, p: Partial<Win>) => setWins((ws) => ws.map((w) => w.id === id ? { ...w, ...p } : w));
  const live = wins.filter((w) => w.state !== "closed");
  const taskRect = (id: AppId): Box | undefined => {
    const b = document.querySelector('.oc-taskbar [title="' + APPS[id].title + '"]');
    if (!b) return undefined;
    const r = b.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  };
  const minimize = (id: AppId) => patch(id, { state: "min", target: taskRect(id) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      if (e.key === "Escape") { setLauncher(false); setTaskview(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);

  const onBarDown = (id: AppId) => (e: JSX.TargetedPointerEvent<HTMLElement>) => {
    const w = wins.find((x) => x.id === id);
    if (!w || w.state !== "normal") return;
    drag.current = { id, sx: e.clientX, sy: e.clientY, x: w.x, y: w.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => { const d = drag.current; if (d) patch(d.id, { x: d.x + e.clientX - d.sx, y: Math.max(0, d.y + e.clientY - d.sy) }); };
  const onUp = () => { drag.current = null; };

  const snap = () => {
    if (snapped) { setWins((ws) => ws.map((w) => w.id === "files" || w.id === "inspector" ? { ...w, state: "normal" } : w)); setSnapped(false); return; }
    setWins((ws) => ws.map((w) => w.id === "files" ? { ...w, state: "snap-left" } : w.id === "inspector" ? { ...w, state: "snap-right" } : w.id === "table" ? { ...w, state: "min" } : w));
    setSnapped(true);
  };

  const tasks = live.map((w) => ({ id: w.id, title: APPS[w.id].title, icon: appIcon(w.id), state: w.state === "min" ? "minimized" as const : w.id === focused ? "active" as const : "running" as const }));
  const onTask = (id: string) => {
    const w = wins.find((x) => x.id === id);
    if (!w) return;
    if (w.state === "min") { patch(w.id, { state: "normal" }); focus(w.id); }
    else if (w.id === focused) minimize(w.id);
    else focus(w.id);
  };
  const open = (id: AppId) => { const w = wins.find((x) => x.id === id); if (w && w.state === "closed") { setWins((ws) => ws.filter((x) => x.id !== id).concat({ ...w, state: "normal", closing: false })); } else if (w) patch(id, { state: "normal" }); else setWins((ws) => ws.concat({ id, x: 140, y: 60, w: 420, h: 280, state: "normal" })); focus(id); setLauncher(false); setPalette(false); };

  const content = (id: AppId) => id === "files" ? <FilesApp sel={sel} setSel={setSel} /> : id === "inspector" ? <InspectorApp sel={sel} /> : <TableApp />;
  const status = (id: AppId) => id === "files" ? <StatusBar>24 items · <strong>{sel.length} selected</strong> · 48.2 MB</StatusBar> : id === "table" ? <StatusBar>4 locations</StatusBar> : null;

  return (
    <Desktop style={{ position: "absolute", inset: 0 }} onPointerMove={onMove} onPointerUp={onUp}
      onContextMenu={(e) => { if (e.target instanceof Element && e.target.closest(".oc-window")) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setCtx({ x: e.clientX - r.left, y: e.clientY - r.top }); }}
      onPointerDown={(e) => { const t = e.target; if (t instanceof Element && (t.classList.contains("oc-desktop__area") || t.classList.contains("oc-desktop__icons"))) { setIconSel([]); setLauncher(false); } }}
      icons={<>
        {DESK_ICONS.map(([id, kind, name]) =>
          <FileTile key={id} kind={kind} name={name} shortcut={id === "notes"} selected={iconSel.includes(id)} onClick={() => setIconSel([id])} onDblClick={() => open("files")} />)}
      </>}
      taskbar={<Taskbar launcherOpen={launcher} onLauncher={() => setLauncher((l) => !l)} tasks={tasks} onTask={onTask}
        pinned={[{ id: "cam", title: "Camera", icon: <AppIcon glyph="camera" color={1} size={16} /> }]}>
        <EnvMarker env="staging" />
        <TaskbarButton icon="layers" label="Task view" active={taskview} onClick={() => setTaskview((t) => !t)} />
        <TaskbarButton icon="search" label="Command palette (Ctrl+K)" onClick={() => setPalette(true)} />
        <TaskbarButton icon={theme === "dark" ? "moon" : "sun"} label={"Theme: " + (theme === "dark" ? "Dark" : "Light")} onClick={() => setTheme(theme === "dark" ? "light" : "dark")} />
        <TaskbarButton icon="film">Harbour film</TaskbarButton>
        <TaskbarClock>14:32</TaskbarClock>
      </Taskbar>}
      overlay={<>
        {launcher && <Launcher style={{ left: 4, bottom: 36 }} onOpen={(id) => isApp(id) ? open(id) : setToast("Not part of this specimen")}
          apps={[{ id: "files", label: "Files", glyph: "folder", color: 5 }, { id: "inspector", label: "Inspector", glyph: "lens", color: 6 }, { id: "table", label: "Locations", glyph: "pin", color: 3 }, { id: "cam", label: "Camera", glyph: "camera", color: 1 }, { id: "map", label: "Map", glyph: "map", color: 4 }, { id: "time", label: "Timeline", glyph: "film", color: 8 }, { id: "set", label: "Settings", glyph: "sliders" }]}
          extensions={[{ id: "lights", label: "Lights", glyph: "sun", color: 2 }, { id: "flows", label: "Flows", glyph: "layers", enabled: false }]} />}
        {taskview && <TaskView current="d1" onDesk={() => setTaskview(false)} onWindow={(id) => { if (isApp(id)) focus(id); setTaskview(false); }} onAdd={() => setToast("Desktop added")}
          desks={[{ id: "d1", label: "Prep", windows: live.map((w) => ({ id: w.id, title: APPS[w.id].title, icon: appIcon(w.id) })) }, { id: "d2", label: "Edit", windows: [{ id: "z", title: "Timeline" }] }]} />}
        {palette && <CommandPalette onClose={() => setPalette(false)} onSelect={(id) => { if (isApp(id)) open(id); else if (id === "theme") { setTheme(theme === "dark" ? "light" : "dark"); setPalette(false); } else if (id === "snap") { snap(); setPalette(false); } else setPalette(false); }}
          items={[{ id: "files", label: "Files", icon: "folder", group: "Apps" }, { id: "inspector", label: "Inspector", icon: "lens", group: "Apps" }, { id: "table", label: "Locations", icon: "pin", group: "Apps" }, { id: "snap", label: snapped ? "Unsnap windows" : "Snap Files and Inspector side by side", icon: "window", kbd: "Ctrl+Left", group: "Windows" }, { id: "theme", label: "Switch to " + (theme === "dark" ? "Light" : "Dark"), icon: theme === "dark" ? "sun" : "moon", group: "System" }]} />}
        {ctx && <ContextMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} onSelect={(id) => { setCtx(null); if (id === "snap") snap(); else if (id === "theme") setTheme(theme === "dark" ? "light" : "dark"); else setToast("Specimen only"); }}
          items={[{ id: "new", label: "New folder", icon: "folder", kbd: "Ctrl+Shift+N" }, { id: "paste", label: "Paste", icon: "copy", disabled: true }, { separator: true }, { id: "snap", label: snapped ? "Unsnap windows" : "Snap windows", icon: "window" }, { id: "theme", label: "Switch theme", icon: theme === "dark" ? "sun" : "moon" }]} />}
        {toast && <div className="oc-toast-stack" style={{ bottom: 44 }}><Toast tone="info" onDismiss={() => setToast(null)}>{toast}</Toast></div>}
      </>}>
      {order.map((id) => {
        const w = wins.find((x) => x.id === id);
        if (!w || w.state === "closed") return null;
        const state = w.state;
        return (
          <AppWindow key={id} title={APPS[id].title} icon={appIcon(id)} focused={id === focused} state={state}
            style={{ left: w.x, top: w.y, width: w.w, height: w.h }} onFocus={() => focus(id)} onBarPointerDown={onBarDown(id)}
            onMinimize={() => minimize(id)} onMaximize={() => patch(id, { state: state === "max" ? "normal" : "max" })} onClose={() => patch(id, { closing: true })}
            closing={w.closing} onClosed={() => patch(id, { state: "closed", closing: false })} minimizeTarget={w.target}
            statusBar={status(id)}>
            {content(id)}
          </AppWindow>
        );
      })}
      {snapped && <SnapGrip />}
    </Desktop>
  );
}

/** Stages Sign in → Projects → Desktop; theme and stage persist. The theme sits on the kit root, not on <html>. */
export default function DesktopKit() {
  const [theme, setThemeState] = useState(() => load("oc-studio-theme", "light"));
  const [stage, setStage] = useState(() => load("oc-studio-stage", "desktop"));
  const setTheme = (t: string) => { setThemeState(t); save("oc-studio-theme", t); };
  const go = (s: string) => { setStage(s); save("oc-studio-stage", s); };
  return (
    <div className="kit-desktop" data-theme={theme}>
      {stage === "signin" && <SignIn env="staging" style={{ position: "absolute" }} onSubmit={() => go("picker")} />}
      {stage === "picker" && <ProjectPicker env="staging" user="Ada Okafor" onPick={() => go("desktop")} onSignOut={() => go("signin")}
        projects={[{ id: "a", name: "Harbour film", meta: "12 Nov" }, { id: "b", name: "Night shoot tests", meta: "3 Nov" }, { id: "c", name: "Brewery commercial", meta: "21 Oct" }]} />}
      {stage === "desktop" && <Studio theme={theme} setTheme={setTheme} />}
      <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2000, display: "flex", gap: 4 }}>
        <Segmented value={stage} onChange={go} label="Specimen stage" options={[{ value: "signin", label: "Sign in" }, { value: "picker", label: "Projects" }, { value: "desktop", label: "Desktop" }]} />
      </div>
    </div>
  );
}
