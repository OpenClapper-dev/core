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
import { setTheme, useTheme } from "../theme";
import { Button, ConfirmHost, Empty, Loading, toast, ToastHost } from "../ui";
import { requestClose } from "./closeGuards";
import { Desktop } from "./Desktop";
import * as desktopState from "./desktopState";
import { setFocusSource } from "./keyboard";
import { closeOverlay, openOverlay, useOverlay } from "./overlays";
import { openHash, startRouteBridge } from "./routeBridge";
import { Taskbar } from "./Taskbar";
import { Window } from "./Window";
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
 * The desktop shell (replaces App in main.tsx, epic #72): loads the data cache, asks for a
 * project when none is chosen, then shows that project's desktop — windows, snap preview,
 * taskbar — with the global overlays (Go to…, shortcuts, confirm, toasts) above it.
 */
export function Shell() {
  const d = data.useData();
  const projectId = useProjectId();
  const loaded = data.loaded(d);
  const valid = loaded && !!projectId && d.projects!.some((p) => p.id === projectId) ? projectId : null;
  const [ready, setReady] = useState<string | null>(null);

  useEffect(() => { void data.load(); }, []);
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
  const windows = wm.useWindows();
  const focusedId = wm.useFocusedId();
  const preview = wm.useSnapPreview();
  const overlay = useOverlay();
  const [days, setDays] = useState<ShootingDay[]>([]);
  const pd = data.useProjectData(projectId);
  const [theme] = useTheme();

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
    { id: "a-reload", group: "Actions", icon: "refresh", title: "Reload data", run: data.reload },
    { id: "a-keys", group: "Actions", icon: "keyboard-outline", title: "Keyboard shortcuts", keys: "?", run: () => openOverlay("sheet") },
  ];

  return (
    <div class="wm-root">
      <div ref={area} class="wm-area">
        <Desktop />
        {ready && windows.map((w) => {
          const def = appDef(w.app);
          if (!def) return null;
          const Comp = def.component;
          return (
            <Window key={w.id} win={w} icon={def.icon} focused={w.id === focusedId}>
              <Comp win={w} focused={w.id === focusedId} resource={w.resource} setTitle={(t) => wm.setTitle(w.id, t)}
                replaceRoute={(r) => wm.setRoute(w.id, routeHash(r))}
                open={(intent) => launch(intent)} close={() => void requestClose(w.id)} />
            </Window>
          );
        })}
        {preview && <div class={`wm-snap-preview wm-snap-preview--${preview}`} />}
      </div>
      <Taskbar projectId={projectId} onPalette={openPalette} />
      {overlay === "palette" && (
        <CommandPalette shots={pd.scoped} locations={pd.locations} views={pd.views} projects={pd.data.projects ?? []} days={days} actions={actions} onClose={closeOverlay}
          onOpenShot={(s) => launch({ app: "shot", resource: { type: "shot", id: s.id }, state: { stage: "photo", list: [s.id] } })}
          onLocation={(l) => launch({ app: "gallery", state: { locationId: l.id } })}
          onView={(v) => launch({ app: "gallery", state: { viewId: v.id } })}
          onProject={(p) => void switchProject(p.id).then((ok) => ok && toast(`Now working on ${p.name}`))}
          onDay={(day) => launch({ app: "plan", state: { dayId: day.id } })} />
      )}
      {overlay === "sheet" && <ShortcutSheet onClose={closeOverlay} />}
      {overlay === "newShot" && <NewShotDialog projectId={projectId} locations={pd.locations} onLocations={data.setLocationsOf(projectId)} onClose={closeOverlay}
        onCreated={(list) => {
          data.created(list);
          closeOverlay();
          const first = list[0];
          if (first) launch({ app: "shot", resource: { type: "shot", id: first.id }, state: { stage: "photo", list: list.map((x) => x.id), line: "Just created" } });
        }} />}
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}
