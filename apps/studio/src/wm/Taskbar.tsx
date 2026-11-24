import { useEffect, useState } from "preact/hooks";
import { AppIcon, EnvMarker, Launcher, Taskbar as Bar, TaskbarButton, TaskbarClock } from "@openclapper/design";
import { appDef, apps, launch } from "../apps/registry";
import { lookOf } from "../fileKinds";
import * as ops from "../fileOps";
import * as store from "../files";
import { contextMenu, toast, type MenuEntry } from "../hosts";
import { envOf, useInstance } from "../instance";
import { samePin, setPrefs, usePrefs, type Pin } from "../prefs";
import { switchProject } from "../project";
import { useProjects } from "../projects";
import { THEMES, THEME_LABEL, useTheme } from "../theme";
import { signOut, useUser } from "../user";
import { requestClose } from "./closeGuards";
import { closeOverlay, openOverlay, useOverlay } from "./overlays";
import { windowMenu } from "./Window";
import * as wm from "./wm";
import type { Win } from "./wm";

function useClock(): string {
  const fmt = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const [t, setT] = useState(fmt);
  useEffect(() => { const i = setInterval(() => setT(fmt()), 10_000); return () => clearInterval(i); }, []);
  return t;
}

/** What a project's taskbar starts with. */
export const DEFAULT_PINS: Pin[] = [{ app: "files" }, { app: "media" }, { app: "project" }];
const pinId = (p: Pin) => ("app" in p ? `app:${p.app}` : `file:${p.file}`);
const PIN_DRAG = "application/x-oc-pin";

export const pinsOf = (projectId: string, pins: Record<string, Pin[]>) => pins[projectId] ?? DEFAULT_PINS;
function setPins(projectId: string, all: Record<string, Pin[]>, next: Pin[]) { setPrefs({ pins: { ...all, [projectId]: next } }); }
/** Pin an app to the taskbar, or take its pin away. */
export function togglePin(projectId: string, all: Record<string, Pin[]>, pin: Pin) {
  const cur = pinsOf(projectId, all);
  setPins(projectId, all, cur.some((p) => samePin(p, pin)) ? cur.filter((p) => !samePin(p, pin)) : [...cur, pin]);
}

/** A menu that opens from a taskbar button, on the side away from the bar. */
const below = (e: MouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return { x: r.left, y: r.top < innerHeight / 2 ? r.bottom + 4 : r.top - 4 }; };

/**
 * The taskbar, on any edge: the launcher, the task view, the pins, the active desktop's windows,
 * then project, Go to…, theme, account and clock. An app's pin and its windows are one button.
 */
export function Taskbar({ projectId }: { projectId: string }) {
  const windows = wm.useWindows();
  const focusedId = wm.useFocusedId();
  const desks = wm.useDesks();
  const active = wm.useActiveDesk();
  const prefs = usePrefs();
  const overlay = useOverlay();
  const [theme, setTheme] = useTheme();
  const { list } = useProjects();
  const user = useUser();
  const instance = useInstance();
  const clock = useClock();
  const { files } = store.useRoot({ project: projectId });
  const fileMap = store.byId(files ?? []);
  // A pin whose app this build does not have, or whose file is gone, is not shown (it comes back with it).
  const pins = pinsOf(projectId, prefs.pins).filter((p) => ("app" in p ? appDef(p.app) : !files || fileMap.has(p.file)));
  const pinned = (app: string) => pins.some((p) => "app" in p && p.app === app);
  const winsOf = (p: Pin) => ("app" in p ? windows.filter((w) => w.app === p.app) : []);
  const running = windows.filter((w) => !pinned(w.app)); // insertion order: z churn must not shuffle the tasks
  const isActive = (w: Win) => w.id === focusedId && w.mode !== "min";
  const toggleWin = (w: Win) => (isActive(w) ? wm.minimize(w.id) : wm.focus(w.id));
  const winEntries = (wins: Win[]): MenuEntry[] => wins.map((w) => ({ id: w.id, label: w.title, checked: w.id === focusedId ? true : undefined, run: () => wm.focus(w.id) }));

  const onTask = (id: string, e: MouseEvent) => {
    const pin = pins.find((p) => pinId(p) === id);
    if (!pin) { const w = windows.find((x) => x.id === id); if (w) toggleWin(w); return; }
    const wins = winsOf(pin);
    if (wins.length === 1) toggleWin(wins[0]);
    else if (wins.length > 1) contextMenu(below(e), winEntries(wins));
    else if ("app" in pin) launch({ app: pin.app });
    else { const f = fileMap.get(pin.file); if (f) ops.openFile(f, fileMap); }
  };
  const onTaskMenu = (id: string, e: MouseEvent) => {
    const pin = pins.find((p) => pinId(p) === id);
    if (pin) {
      const wins = winsOf(pin);
      contextMenu(e, [
        ...winEntries(wins), wins.length > 0 && { separator: true },
        { id: "open", label: wins.length ? "Open again" : "Open", icon: "external", run: () => { if ("app" in pin) launch({ app: pin.app }); else { const f = fileMap.get(pin.file); if (f) ops.openFile(f, fileMap); } } },
        { id: "unpin", label: "Unpin from taskbar", icon: "pinned", run: () => togglePin(projectId, prefs.pins, pin) },
        wins.length > 0 && { id: "close", label: wins.length > 1 ? `Close ${wins.length} windows` : "Close window", icon: "close", danger: true, run: () => { for (const w of wins) void requestClose(w.id); } },
      ]);
      return;
    }
    const w = windows.find((x) => x.id === id);
    if (w) contextMenu(e, windowMenu(w, [{ id: "pin", label: "Pin app to taskbar", icon: "pin", run: () => togglePin(projectId, prefs.pins, { app: w.app }) }, { separator: true }]));
  };

  // Pins are reordered by dragging one onto another's place.
  const [dropAt, setDropAt] = useState<number | null>(null);
  const indexAt = (e: DragEvent) => { const el = (e.target as HTMLElement).closest<HTMLElement>("[data-pin-index]"); return el ? Number(el.dataset.pinIndex) : pins.length; };
  const groupProps = {
    onDragStart: (e: DragEvent) => { const id = (e.target as HTMLElement).closest<HTMLElement>("[data-pin-id]")?.dataset.pinId; if (id && e.dataTransfer) { e.dataTransfer.setData(PIN_DRAG, id); e.dataTransfer.effectAllowed = "move"; } },
    onDragOver: (e: DragEvent) => { const pin = e.dataTransfer?.types.includes(PIN_DRAG); if (!pin && !ops.hasDrag(e)) return; e.preventDefault(); e.dataTransfer!.dropEffect = pin ? "move" : "copy"; setDropAt(indexAt(e)); },
    onDragLeave: (e: DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropAt(null); },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDropAt(null);
      const at = indexAt(e);
      // Files dragged here from Files or the desktop are pinned at that place.
      const dropped = ops.readDrag(e);
      if (dropped) { const add = dropped.filter((id) => fileMap.has(id) && !pins.some((p) => "file" in p && p.file === id)).map((id): Pin => ({ file: id })); const order = [...pins]; order.splice(at, 0, ...add); setPins(projectId, prefs.pins, order); return; }
      const moving = pins.find((p) => pinId(p) === e.dataTransfer?.getData(PIN_DRAG));
      if (!moving) return;
      const from = pins.indexOf(moving);
      const order = pins.filter((p) => p !== moving);
      order.splice(Math.min(at > from ? at - 1 : at, order.length), 0, moving);
      setPins(projectId, prefs.pins, order);
    },
    "data-drop-at": dropAt ?? undefined,
  };

  const projects = list ?? [];
  const project = projects.find((p) => p.id === projectId);
  const projectMenu = (e: MouseEvent) => contextMenu(below(e), [
    { heading: "Project" },
    ...projects.map((p): MenuEntry => ({ id: p.id, label: p.name, checked: p.id === projectId ? true : undefined, icon: "slate", run: () => { if (p.id !== projectId) void switchProject(p.id).then((ok) => ok && toast(`Now working on ${p.name}`)); } })),
    { separator: true },
    { id: "manage", label: "Manage projects…", icon: "settings", run: () => { launch({ app: "project", state: { tab: "projects" } }); } },
  ]);
  const me = user.status === "signed-in" ? user.me.user : null;
  const userMenu = (e: MouseEvent) => me && contextMenu(below(e), [
    { heading: me.name ? `${me.name} · ${me.email}` : me.email },
    { id: "account", label: "Account…", icon: "user", run: () => { launch({ app: "settings", state: { tab: "account" } }); } },
    { separator: true },
    { id: "out", label: "Sign out", icon: "logout", run: () => void signOut() },
  ]);
  const deskMenu = (e: MouseEvent) => contextMenu(e, [
    { heading: "Desktops" },
    ...desks.map((d, i): MenuEntry => ({ id: d.id, label: d.name, icon: "desktop", checked: d.id === active ? true : undefined, kbd: i < 9 ? `⌘Alt${i + 1}` : undefined, run: () => wm.switchDesk(d.id) })),
    { separator: true },
    { id: "new", label: "New desktop", icon: "plus", kbd: "⌘Alt N", run: () => { wm.addDesk({ go: true }); } },
    { id: "view", label: "Task view…", icon: "layers", kbd: "⌘Alt V", run: () => openOverlay("taskview") },
  ]);

  const launcherOpen = overlay === "launcher";
  // Esc closes the launcher wherever the focus went meanwhile (a menu opened from it takes the focus away).
  useEffect(() => {
    if (!launcherOpen) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".st-menuhost")) { e.stopPropagation(); closeOverlay(); } };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [launcherOpen]);
  const env = envOf(instance);
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  return (
    <>
      <Bar edge={prefs.taskbarEdge} align={prefs.taskbarAlign} launcherOpen={launcherOpen} onLauncher={() => openOverlay(launcherOpen ? null : "launcher")}
        leading={<TaskbarButton icon="layers" label={`Task view (⌘Alt V) · ${desks.find((d) => d.id === active)?.name ?? ""}`} active={overlay === "taskview"} count={desks.length > 1 ? desks.findIndex((d) => d.id === active) + 1 : undefined}
          onClick={() => openOverlay(overlay === "taskview" ? null : "taskview")} onContextMenu={deskMenu} />}
        pinsDraggable groupProps={groupProps} onTask={onTask} onTaskMenu={onTaskMenu}
        pinned={pins.map((p) => {
          const def = "app" in p ? appDef(p.app) : undefined;
          const file = "file" in p ? fileMap.get(p.file) : undefined;
          const look = file ? lookOf(file, fileMap) : def;
          const wins = winsOf(p);
          return { id: pinId(p), title: wins.length > 1 ? `${def?.name} · ${wins.length} windows` : wins[0]?.title ?? def?.name ?? file?.name ?? "", icon: <AppIcon glyph={look?.glyph} color={look?.color} size={20} />, state: wins.some(isActive) ? "active" as const : wins.length ? "running" as const : undefined, count: wins.length };
        })}
        tasks={running.map((w) => { const def = appDef(w.app); return { id: w.id, title: w.title, icon: <AppIcon glyph={def?.glyph} color={def?.color} size={20} />, state: isActive(w) ? "active" as const : w.mode === "min" ? "minimized" as const : "running" as const }; })}>
        {env !== "production" && <EnvMarker env={env} className="st-env" />}
        <TaskbarButton icon="slate" label={`Switch project · ${project?.name ?? ""}`} onClick={projectMenu}>{project?.name ?? "—"}</TaskbarButton>
        <TaskbarButton icon="search" label="Go to… (⌘K)" onClick={() => openOverlay("palette")} />
        <TaskbarButton icon={theme === "auto" ? "desktop" : theme === "light" ? "sun" : "moon"} label={`${THEME_LABEL[theme]} (click for ${next === "auto" ? "the system's" : next})`} onClick={() => setTheme(next)} />
        <TaskbarButton icon="user" label={me ? `Account · ${me.email}` : "Account"} onClick={userMenu} />
        <TaskbarClock>{clock}</TaskbarClock>
      </Bar>
      {launcherOpen && (
        <div className="st-launcher" data-overlay data-edge={prefs.taskbarEdge} data-align={prefs.taskbarAlign} onPointerDown={(e) => { if (e.target === e.currentTarget) closeOverlay(); }}>
          <Launcher apps={apps().filter((a) => a.tier !== "extension").map((a) => ({ id: a.id, label: a.name, glyph: a.glyph, color: a.color }))}
            extensions={apps().filter((a) => a.tier === "extension").map((a) => ({ id: a.id, label: a.name, glyph: a.glyph, color: a.color }))}
            onOpen={(id) => { closeOverlay(); launch({ app: id }); }}
            onMenu={(id, e) => contextMenu(e, [
              { id: "open", label: "Open", icon: "external", run: () => { closeOverlay(); launch({ app: id }); } },
              { id: "pin", label: pinned(id) ? "Unpin from taskbar" : "Pin to taskbar", icon: pinned(id) ? "pinned" : "pin", run: () => togglePin(projectId, prefs.pins, { app: id }) },
            ])} />
        </div>
      )}
    </>
  );
}
