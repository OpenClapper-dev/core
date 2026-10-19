import { useEffect, useRef, useState } from "preact/hooks";
import type { ShootingDay } from "../api";
import { appDef, launch, type AppId } from "../apps/registry";
import { CommandPalette, ShortcutSheet, type Command } from "../CommandPalette";
import * as data from "../data";
import { projectDays } from "../Inspector";
import { NewShotDialog } from "../NewShot";
import { bind, useKeys } from "../keys";
import { setProjectId, switchProject, useProjectId } from "../project";
import { ProjectGate } from "../Projects";
import { routeHash } from "../router";
import { SignInPage } from "../SignIn";
import { useSettings } from "../settings";
import { Button, ConfirmHost, Empty, Loading, Presence, setTheme, toast, ToastHost, useTheme } from "@fielder/ui";
import { boot, signOut, useUser } from "../user";
import { requestClose } from "./closeGuards";
import { Desktop } from "./Desktop";
import * as desktopState from "./desktopState";
import { setFocusSource } from "./keyboard";
import { closeOverlay, openOverlay, useOverlay } from "./overlays";
import { openHash, startRouteBridge } from "./routeBridge";
import { Taskbar } from "./Taskbar";
import { TaskView } from "./TaskView";
import { SplitGrip } from "./SplitGrip";
import { WindowGhosts } from "./WindowGhosts";
import { Window } from "./Window";
import { goToWorkspace } from "./switchWorkspace";
import * as wm from "./wm";

setFocusSource(wm.getFocusedId);

/** The project whose desktop the wm store holds right now; saves go there. */
let desktopOf: string | null = null;
wm.subscribe(() => { if (desktopOf) desktopState.save(desktopOf, wm.snapshot()); });

/**
 * Swap the wm store to a project's desktop: write out the old one, restore the new one as it was
 * left (windows of apps this build no longer knows are dropped; min sizes come from the registry).
 */
function showDesktop(projectId: string) {
  desktopState.flush();
  desktopOf = projectId;
  const stored = desktopState.load(projectId);
  if (stored) wm.hydrate({ ...stored, windows: stored.windows.filter((w) => appDef(w.app)).map((w) => ({ ...w, min: appDef(w.app)!.minSize })) });
  else wm.reset();
}

/**
 * The Studio (main.tsx): the sign-in page until someone is signed in (epic #107), then their
 * desktop. Keyed by the user, so another account starts from a fresh data cache.
 */
export function Shell() {
  const user = useUser();
  useEffect(() => { void boot(); }, []);
  if (user.status === "signed-in") return <SignedIn key={user.me.user.id} />;
  return (
    <div class="wm-root wm-root--bare">
      {user.status === "signed-out" ? <SignInPage />
        : user.status === "error" ? <Empty icon="cloud-alert" title="Could not reach Fielder" actions={<Button onClick={() => void boot()}>Try again</Button>}>{user.message}</Empty>
        : <Loading />}
      <ToastHost />
    </div>
  );
}

/**
 * The desktop shell (epic #72): loads the data cache, asks for a project when none is chosen,
 * then shows that project's desktop — windows, snap preview, taskbar — with the global overlays
 * (Go to…, shortcuts, confirm, toasts) above it.
 */
function SignedIn() {
  const d = data.useData();
  const projectId = useProjectId();
  const loaded = data.loaded(d);
  const valid = loaded && !!projectId && d.projects!.some((p) => p.id === projectId) ? projectId : null;
  const [ready, setReady] = useState<string | null>(null);

  useEffect(() => {
    data.clear();
    void data.load();
    // The sign-in page's #/register is no deep link into the desktop.
    if (location.hash === "#/register") history.replaceState(null, "", "#/");
  }, []);
  useEffect(() => {
    if (!valid) return;
    const first = ready === null;
    showDesktop(valid);
    // A deep link applies once, on top of the restored desktop; later the bridge keeps the URL.
    if (first) openHash(location.hash);
    setReady(valid);
  }, [valid]);
  useEffect(() => (ready ? startRouteBridge() : undefined), [!!ready]);
  useEffect(() => {
    const flush = () => desktopState.flush();
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  if (!loaded) {
    return (
      <div class="wm-root wm-root--bare">
        {d.error ? <Empty icon="cloud-alert" title="Could not load" actions={<Button onClick={() => void data.load()}>Try again</Button>}>{d.error}</Empty> : <Loading />}
        <ToastHost />
      </div>
    );
  }
  if (!valid) {
    return <div class="wm-root wm-root--bare"><ProjectGate projects={d.projects!} onChange={data.setProjects} onActivate={setProjectId} /><ConfirmHost /><ToastHost /></div>;
  }
  return <DesktopShell projectId={valid} ready={ready === valid} />;
}

function DesktopShell({ projectId, ready }: { projectId: string; ready: boolean }) {
  const area = useRef<HTMLDivElement>(null);
  const windows = wm.useAllWindows();
  const activeWs = wm.useActiveWs();
  const split = wm.useSplit();
  const settings = useSettings();
  const focusedId = wm.useFocusedId();
  const preview = wm.useSnapPreview();
  const overlay = useOverlay();
  const [days, setDays] = useState<ShootingDay[]>([]);
  const pd = data.useProjectData(projectId);
  const [theme] = useTheme();
  const user = useUser();
  // Windows animate their opening only once the desktop stands (motion.css): not the whole set a
  // project restores on load or on a switch.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    if (!ready) return;
    let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => setSettled(true)); });
    return () => cancelAnimationFrame(raf);
  }, [ready, projectId]);

  useEffect(() => {
    const el = area.current!;
    const fit = () => wm.setViewport({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { if (overlay === "palette") void projectDays(projectId).then(setDays).catch(() => {}); }, [overlay]);
  const openPalette = () => openOverlay("palette");
  const app = (id: AppId, state?: unknown) => () => { launch({ app: id, state }); };
  const focusedWin = () => windows.find((w) => w.id === focusedId) ?? null;
  /** Workspace n (1-based) from a digit key, by its physical key. */
  const wsOfKey = (e: KeyboardEvent) => wm.getWorkspaces()[Number(e.code.slice(5)) - 1];
  const onFocused = (fn: (id: string) => void) => () => { const w = focusedWin(); if (w) fn(w.id); };

  useKeys(bind("global", {
    palette: openPalette,
    sheet: () => openOverlay("sheet"),
    goShots: app("gallery"),
    goTimeline: app("timeline"),
    goPlan: app("plan"),
    goMetadata: app("metadata"),
    goFiles: app("files"),
    goLibrary: app("projects"),
    goMap: app("gallery", { layout: "map" }),
  }), !overlay);
  useKeys(bind("wm", {
    next: () => wm.cycle(1),
    prev: () => wm.cycle(-1),
    close: onFocused((id) => void requestClose(id)),
    minimize: onFocused(wm.minimize),
    maximize: onFocused(wm.toggleMax),
    snapLeft: onFocused((id) => wm.setSnap(id, focusedWin()?.snap === "left" && focusedWin()?.mode === "snapped" ? null : "left")),
    snapRight: onFocused((id) => wm.setSnap(id, focusedWin()?.snap === "right" && focusedWin()?.mode === "snapped" ? null : "right")),
    desktop: () => wm.toggleDesktop(),
    taskView: () => openOverlay("taskview"),
    wsNext: () => goToWorkspace(1),
    wsPrev: () => goToWorkspace(-1),
    wsNew: () => { wm.addWorkspace({ go: true }); },
    wsGo: (e) => { const ws = wsOfKey(e); if (ws) goToWorkspace(ws.id); else return false; },
    wsMove: (e) => { const w = focusedWin(); const ws = wsOfKey(e); if (!w || !ws) return false; wm.moveToWorkspace(w.id, ws.id); },
  }), !overlay);

  const actions: Command[] = [
    { id: "a-gallery", group: "Open", icon: "view-grid-outline", title: "Gallery", keys: "G S", run: app("gallery") },
    { id: "a-timeline", group: "Open", icon: "filmstrip", title: "Timeline", keys: "G T", run: app("timeline") },
    { id: "a-plan", group: "Open", icon: "calendar-clock", title: "Plan", keys: "G P", run: app("plan") },
    { id: "a-metadata", group: "Open", icon: "tag-multiple-outline", title: "Metadata", keys: "G D", run: app("metadata") },
    { id: "a-files", group: "Open", icon: "folder-multiple-outline", title: "Files", keys: "G F", run: app("files") },
    { id: "a-map", group: "Open", icon: "map-outline", title: "Map", keys: "G M", run: app("gallery", { layout: "map" }) },
    { id: "a-lib", group: "Open", icon: "bookshelf", title: "Library: projects, fields, rigs, locations", keys: "G L", run: app("projects") },
    { id: "a-settings", group: "Open", icon: "cog-outline", title: "Settings", sub: "Theme, frame mode, new shots", run: app("settings") },
    { id: "a-newshot", group: "Actions", icon: "image-plus", title: "New shot", sub: "Upload images or draw a sketch", run: () => openOverlay("newShot") },
    { id: "a-theme", group: "Actions", icon: "theme-light-dark", title: "Toggle theme", sub: `Now ${theme === "auto" ? "Auto" : theme === "sun" ? "Sun" : "Set"}`, run: () => setTheme(theme === "set" ? "sun" : "set") },
    { id: "a-desktop", group: "Actions", icon: "monitor", title: "Show the desktop", keys: "⌘Alt D", run: () => wm.toggleDesktop() },
    { id: "a-taskview", group: "Actions", icon: "view-dashboard-outline", title: "Task view", sub: "Workspaces and their windows", keys: "⌘Alt V", run: () => openOverlay("taskview") },
    { id: "a-newws", group: "Actions", icon: "monitor-multiple", title: "New workspace", keys: "⌘Alt N", run: () => { wm.addWorkspace({ go: true }); } },
    { id: "a-reload", group: "Actions", icon: "refresh", title: "Reload data", run: data.reload },
    { id: "a-keys", group: "Actions", icon: "keyboard-outline", title: "Keyboard shortcuts", keys: "?", run: () => openOverlay("sheet") },
    { id: "a-account", group: "Open", icon: "account-circle-outline", title: "Account and workspaces", sub: "Members, roles, sign out", run: () => launch({ app: "settings", state: { tab: "account" } }) },
    { id: "a-signout", group: "Actions", icon: "logout", title: "Sign out", sub: user.status === "signed-in" ? user.me.user.email : undefined, run: () => void signOut() },
  ];

  return (
    <div class={settled ? "wm-root is-settled" : "wm-root"} data-taskbar={settings.taskbarPosition}>
      <div ref={area} class="wm-area" style={{ "--wm-split": String(split) }}>
        <Desktop projectId={projectId} />
        {/* Every workspace's windows stay mounted (apps keep their state); the others are hidden. */}
        {ready && windows.map((w) => {
          const def = appDef(w.app);
          if (!def) return null;
          const Comp = def.component;
          return (
            <Window key={w.id} win={w} icon={def.icon} focused={w.id === focusedId} away={w.ws !== activeWs}>
              <Comp win={w} focused={w.id === focusedId} resource={w.resource} setTitle={(t) => wm.setTitle(w.id, t)}
                replaceRoute={(r) => wm.setRoute(w.id, routeHash(r))}
                open={(intent) => launch(intent)} close={() => void requestClose(w.id)} />
            </Window>
          );
        })}
        <WindowGhosts activeWs={activeWs} />
        <SplitGrip />
        {/* Always there, so it can fade in and out (motion.css); data-zone none hides it. */}
        <div class={preview ? `wm-snap-preview wm-snap-preview--${preview}` : "wm-snap-preview"} data-zone={preview ?? "none"} />
      </div>
      <Taskbar projectId={projectId} onPalette={openPalette} />
      {/* Overlays fade out (Presence): the palette, the shortcut sheet, the task view, New shot. */}
      <Presence show={overlay === "palette"}>{overlay === "palette" && (
        <CommandPalette shots={pd.scoped} locations={pd.locations} views={pd.views} projects={pd.data.projects ?? []} days={days} actions={actions} onClose={closeOverlay}
          onOpenShot={(s) => launch({ app: "shot", resource: { type: "shot", id: s.id }, state: { stage: "photo", list: [s.id] } })}
          onLocation={(l) => launch({ app: "gallery", state: { locationId: l.id } })}
          onView={(v) => launch({ app: "gallery", state: { viewId: v.id } })}
          onProject={(p) => void switchProject(p.id).then((ok) => ok && toast(`Now working on ${p.name}`))}
          onDay={(day) => launch({ app: "plan", state: { dayId: day.id } })} />
      )}</Presence>
      <Presence show={overlay === "sheet"}>{overlay === "sheet" && <ShortcutSheet onClose={closeOverlay} />}</Presence>
      <Presence show={overlay === "taskview"}>{overlay === "taskview" && <TaskView onClose={closeOverlay} />}</Presence>
      <Presence show={overlay === "newShot"}>{overlay === "newShot" && <NewShotDialog projectId={projectId} locations={pd.locations} onLocations={data.setLocationsOf(projectId)} onClose={closeOverlay}
        onCreated={(list) => {
          data.created(list);
          closeOverlay();
          const first = list[0];
          if (first) launch({ app: "shot", resource: { type: "shot", id: first.id }, state: { stage: "photo", list: list.map((x) => x.id), line: "Just created" } });
        }} />}</Presence>
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}
