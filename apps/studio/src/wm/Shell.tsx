import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Button, CommandPalette, Desktop, Dialog, EmptyState, ProjectPicker, SignIn, Spinner, type IconName } from "@openclapper/design";
import { ApiError } from "../api";
import { appDef, apps, launch } from "../apps/registry";
import { ShortcutList } from "../apps/SettingsApp";
import { clearFiles } from "../files";
import { Hosts, prompt, toast, toastError, type MenuEntry } from "../hosts";
import { envOf, useInstance } from "../instance";
import { bind, useKeys } from "../keys";
import { forgetPrefs, loadPrefs, usePrefs } from "../prefs";
import { setProjectId, switchProject, useProjectId } from "../project";
import { clearProjects, loadProjects, saveProject, useProjects } from "../projects";
import { THEMES, setTheme, useTheme } from "../theme";
import { boot, signIn, signOut, useUser } from "../user";
import { requestClose, setCloser } from "./closeGuards";
import { DesktopIcons } from "./DesktopIcons";
import * as desktopState from "./desktopState";
import { setFocusSource } from "./keyboard";
import { closeOverlay, openOverlay, useOverlay } from "./overlays";
import { openHash, startRouteBridge } from "./routeBridge";
import { SplitGrip } from "./SplitGrip";
import { Taskbar } from "./Taskbar";
import { TaskView } from "./TaskView";
import { Window } from "./Window";
import * as wm from "./wm";

setFocusSource(wm.getFocusedId);

/** The project whose desktop the wm store holds right now; saves go there. */
let desktopOf: string | null = null;
wm.subscribe(() => { if (desktopOf) desktopState.save(desktopOf, wm.snapshot()); });

/**
 * Swap the wm store to a project's desktop: write out the old one, restore the new one as it was
 * left (windows of apps this build does not know are dropped; min sizes come from the registry).
 */
function showDesktop(projectId: string) {
  desktopState.flush();
  desktopOf = projectId;
  const stored = desktopState.load(projectId);
  // A restored window opens where it was: its route (a tab, a folder) is read back as its launch state.
  if (stored) wm.hydrate({ ...stored, windows: stored.windows.filter((w) => appDef(w.app)).map((w) => { const def = appDef(w.app)!; return { ...w, min: def.minSize, state: w.route ? def.fromRoute?.(w.route).state : undefined }; }) });
  else wm.reset();
}

const Boot = ({ children }: { children: JSX.Element }) => <div className="st-root"><div className="oc-boot">{children}</div><Hosts /></div>;

/**
 * The Studio (main.tsx): the sign-in page until someone is signed in, then their desktop. Keyed by
 * the user, so another account starts from fresh data.
 */
export function Shell() {
  const user = useUser();
  const instance = useInstance();
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);
  useEffect(() => { void boot(); }, []);
  // The preferences are the account's: read when someone is signed in, forgotten when nobody is.
  const who = user.status === "signed-in" ? user.me.user.id : null;
  useEffect(() => { if (who) void loadPrefs(who); else if (user.status === "signed-out") forgetPrefs(); }, [who, user.status]);
  if (user.status === "signed-in") return <SignedIn key={user.me.user.id} />;
  if (user.status === "error") return <Boot><EmptyState icon="cloud-off" title="Could not reach OpenClapper" action={<Button onClick={() => void boot()}>Try again</Button>}>{user.message}</EmptyState></Boot>;
  if (user.status === "checking") return <Boot><Spinner /></Boot>;
  const submit = async ({ email, password }: { email: string; password: string }) => {
    setBusy(true);
    setWrong(null);
    try { await signIn(email.trim(), password); }
    catch (e) { setWrong(e instanceof ApiError && e.status === 401 ? "Email or password is not right" : (e as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="st-root"><SignIn env={envOf(instance)} error={wrong ?? undefined} loading={busy} onSubmit={(v) => void submit(v)} /><Hosts /></div>;
}

/** Loads the projects, asks for one when none is chosen, then shows that project's desktop. */
function SignedIn() {
  const { list, error } = useProjects();
  const projectId = useProjectId();
  const user = useUser();
  const instance = useInstance();
  const valid = list && projectId && list.some((p) => p.id === projectId) ? projectId : null;
  const [ready, setReady] = useState<string | null>(null);

  useEffect(() => { clearProjects(); clearFiles(); void loadProjects(); }, []);
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

  if (!list) return <Boot>{error ? <EmptyState icon="cloud-off" title="Could not load" action={<Button onClick={() => void loadProjects()}>Try again</Button>}>{error}</EmptyState> : <Spinner />}</Boot>;
  if (!valid) {
    const me = user.status === "signed-in" ? user.me : null;
    const wsName = (id: string) => me?.workspaces.find((w) => w.id === id)?.name ?? "";
    const create = async () => {
      const name = await prompt({ title: "New project", label: "Name", confirmLabel: "Create" });
      if (!name) return;
      try { setProjectId((await saveProject(crypto.randomUUID(), name)).id); }
      catch (e) { if (e instanceof ApiError && e.status === 409 && typeof e.body.existing_id === "string") setProjectId(e.body.existing_id); else toastError(e); }
    };
    return (
      <div className="st-root">
        <ProjectPicker env={envOf(instance)} user={me?.user.name ?? me?.user.email} projects={list.map((p) => ({ id: p.id, name: p.name, meta: `${wsName(p.workspace_id)} · ${p.file_count} file${p.file_count === 1 ? "" : "s"}` }))}
          onPick={setProjectId} onNew={() => void create()} onSignOut={() => void signOut()} />
        <Hosts />
      </div>
    );
  }
  return <DesktopShell projectId={valid} ready={ready === valid} />;
}

function DesktopShell({ projectId, ready }: { projectId: string; ready: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const windows = wm.useAllWindows();
  const activeDesk = wm.useActiveDesk();
  const split = wm.useSplit();
  const focusedId = wm.useFocusedId();
  const zone = wm.useSnapPreview();
  const overlay = useOverlay();
  const prefs = usePrefs();
  const [theme] = useTheme();
  const user = useUser();
  const { list } = useProjects();
  // A closed window fades first (the frame's own animation), then leaves the store.
  const [closing, setClosing] = useState<string[]>([]);
  useEffect(() => { setCloser((id) => setClosing((c) => (c.includes(id) ? c : [...c, id]))); return () => setCloser(wm.close); }, []);

  useEffect(() => {
    const el = root.current!.querySelector<HTMLElement>(".oc-desktop__area")!;
    const fit = () => wm.setViewport({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { root.current!.querySelector<HTMLElement>(".oc-desktop__area")!.style.setProperty("--oc-split", String(split)); }, [split]);

  const focusedWin = () => windows.find((w) => w.id === focusedId) ?? null;
  /** Desktop n (1-based) from a digit key, by its physical key. */
  const deskOfKey = (e: KeyboardEvent) => wm.getDesks()[Number(e.code.slice(5)) - 1];
  const onFocused = (fn: (id: string) => void) => () => { const w = focusedWin(); if (w) fn(w.id); };
  const snapTo = (half: "left" | "right") => onFocused((id) => wm.setSnap(id, focusedWin()?.snap === half && focusedWin()?.mode === "snapped" ? null : half));
  const open = (app: string, state?: unknown) => () => { launch({ app, state }); };

  useKeys(bind("global", {
    palette: () => openOverlay("palette"),
    sheet: () => openOverlay("sheet"),
    goFiles: open("files"),
    goProject: open("project"),
    goSettings: open("settings"),
  }), !overlay || overlay === "launcher");
  useKeys(bind("wm", {
    next: () => wm.cycle(1),
    prev: () => wm.cycle(-1),
    close: onFocused((id) => void requestClose(id)),
    minimize: onFocused(wm.minimize),
    maximize: onFocused(wm.toggleMax),
    snapLeft: snapTo("left"),
    snapRight: snapTo("right"),
    desktop: () => wm.toggleDesktop(),
    taskView: () => openOverlay("taskview"),
    deskNext: () => wm.switchDesk(1),
    deskPrev: () => wm.switchDesk(-1),
    deskNew: () => { wm.addDesk({ go: true }); },
    deskGo: (e) => { const d = deskOfKey(e); if (d) wm.switchDesk(d.id); else return false; },
    deskMove: (e) => { const w = focusedWin(); const d = deskOfKey(e); if (!w || !d) return false; wm.moveToDesk(w.id, d.id); },
  }), !overlay);

  // Go to… (⌘K): apps, open windows, projects, and the shell's own actions.
  type Command = { id: string; label: string; icon?: IconName; kbd?: string; group: string; run: () => void };
  const nextTheme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const commands: Command[] = [
    ...apps().map((a): Command => ({ id: `app-${a.id}`, group: "Open", icon: a.glyph, label: a.about ? `${a.name} · ${a.about}` : a.name, run: open(a.id) })),
    ...windows.map((w): Command => ({ id: `win-${w.id}`, group: "Windows", icon: appDef(w.app)?.glyph, label: w.title, run: () => wm.focus(w.id) })),
    ...(list ?? []).filter((p) => p.id !== projectId).map((p): Command => ({ id: `proj-${p.id}`, group: "Switch project", icon: "slate", label: p.name, run: () => void switchProject(p.id).then((ok) => ok && toast(`Now working on ${p.name}`)) })),
    { id: "a-theme", group: "Actions", icon: "palette", label: `Theme: switch to ${nextTheme === "auto" ? "the system's" : nextTheme}`, run: () => setTheme(nextTheme) },
    { id: "a-desktop", group: "Actions", icon: "desktop", label: "Show the desktop", kbd: "⌘+Alt+D", run: () => wm.toggleDesktop() },
    { id: "a-taskview", group: "Actions", icon: "layers", label: "Task view", kbd: "⌘+Alt+V", run: () => openOverlay("taskview") },
    { id: "a-newdesk", group: "Actions", icon: "plus", label: "New desktop", kbd: "⌘+Alt+N", run: () => { wm.addDesk({ go: true }); } },
    { id: "a-keys", group: "Actions", icon: "keyboard", label: "Keyboard shortcuts", kbd: "?", run: () => openOverlay("sheet") },
    { id: "a-reload", group: "Actions", icon: "refresh", label: "Reload the Studio", run: () => location.reload() },
    { id: "a-signout", group: "Actions", icon: "logout", label: `Sign out${user.status === "signed-in" ? ` · ${user.me.user.email}` : ""}`, run: () => void signOut() },
  ];

  const pct = (n: number) => `${n * 100}%`;
  const snapPreview: JSX.CSSProperties | undefined = zone === "max" ? { inset: 0 } : zone === "left" ? { left: 0, top: 0, bottom: 0, width: pct(split) } : zone === "right" ? { right: 0, top: 0, bottom: 0, width: pct(1 - split) } : undefined;
  /** What the shell adds to the desktop's right-click menu, under the icons' own entries. */
  const shellMenu: MenuEntry[] = [
    { id: "taskview", label: "Task view", icon: "layers", kbd: "⌘Alt V", run: () => openOverlay("taskview") },
    { id: "newdesk", label: "New desktop", icon: "plus", kbd: "⌘Alt N", run: () => { wm.addDesk({ go: true }); } },
    { separator: true },
    { id: "theme", label: `Theme: switch to ${nextTheme === "auto" ? "the system's" : nextTheme}`, icon: "palette", run: () => setTheme(nextTheme) },
    { id: "settings", label: "Settings…", icon: "settings", run: open("settings") },
  ];

  return (
    <div ref={root} className="st-root">
      <Desktop taskbarEdge={prefs.taskbarEdge} snapPreview={snapPreview} taskbar={<Taskbar projectId={projectId} />}
        icons={<DesktopIcons projectId={projectId} shellMenu={shellMenu} />}
        overlay={<>
          {overlay === "taskview" && <TaskView onClose={closeOverlay} />}
          {overlay === "palette" && <div data-overlay><CommandPalette fixed items={commands} placeholder="Go to an app, a window, a project, or run an action" onClose={closeOverlay} onSelect={(id) => { closeOverlay(); commands.find((c) => c.id === id)?.run(); }} /></div>}
          {overlay === "sheet" && <Dialog fixed data-overlay className="st-sheet" title="Keyboard shortcuts" onClose={closeOverlay}><ShortcutList /></Dialog>}
        </>}>
        {/* Every desktop's windows stay mounted (apps keep their state); the others are hidden. */}
        {ready && windows.map((w) => {
          const def = appDef(w.app);
          if (!def) return null;
          const App = def.component;
          return (
            <Window key={w.id} win={w} def={def} focused={w.id === focusedId} away={w.desk !== activeDesk} closing={closing.includes(w.id)}
              onClosed={() => { setClosing((c) => c.filter((x) => x !== w.id)); wm.close(w.id); }}>
              <App win={w} focused={w.id === focusedId} resource={w.resource} projectId={projectId} setTitle={(t) => wm.setTitle(w.id, t)} setRoute={(r) => wm.setRoute(w.id, r)}
                open={(intent) => { launch(intent); }} close={() => void requestClose(w.id)} />
            </Window>
          );
        })}
        <SplitGrip />
      </Desktop>
      <Hosts />
    </div>
  );
}
