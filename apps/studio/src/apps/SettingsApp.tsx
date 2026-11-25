import { useEffect, useState } from "preact/hooks";
import { FormField, Kbd, Segmented, SettingsGroup, SettingsLayout, Switch } from "@openclapper/design";
import { useInstance } from "../instance";
import { setPrefs, usePrefs, usePrefsState, type Edge } from "../prefs";
import { SCOPES, keysLabel, shortcutsOf, type ScopeId } from "../shortcuts";
import { THEMES, useTheme, type Theme } from "../theme";
import * as store from "../files";
import { useProjects } from "../projects";
import { AccountPage, useWorkspaceList, WorkspacePage, WorkspacesPage } from "./AccountPage";
import { PROJECT_TABS, ProjectPage, type ProjectTab } from "./ProjectApp";
import type { AppProps } from "./registry";
import type { ResourceRef } from "../wm/wm";

const TABS = ["appearance", "account", "shortcuts", "about", "workspaces", ...PROJECT_TABS] as const;
/** A fixed page, or one workspace's page (`ws:<id>`). */
type Tab = (typeof TABS)[number] | `ws:${string}`;
const isTab = (v: unknown): v is Tab => typeof v === "string" && (TABS.includes(v as (typeof TABS)[number]) || v.startsWith("ws:"));
const TITLE: Record<(typeof TABS)[number], string> = { workspaces: "Workspaces", appearance: "Appearance", account: "Account", shortcuts: "Keyboard shortcuts", about: "About", general: "General", customizations: "Customizations", properties: "Properties", naming: "Naming patterns", extensions: "Extensions", projects: "All projects" };
/** A settings page file's page, as a tab (#426: one file per page; "project" is the General page). */
const PAGE_TAB: Record<string, Tab> = { general: "general", properties: "properties", naming: "naming", customizations: "customizations", extensions: "extensions", appearance: "appearance", account: "account", shortcuts: "shortcuts" };

/** Every shortcut of the registry, scope by scope: the same list as the `?` sheet and docs/shortcuts.md. */
export function ShortcutList() {
  return (
    <>
      {(Object.keys(SCOPES) as ScopeId[]).map((id) => (
        <SettingsGroup key={id} title={SCOPES[id].label}>
          <dl className="st-keys">{shortcutsOf(id).map((s) => <div key={s.action}><dt>{s.label}</dt><dd><Kbd keys={[keysLabel(s)]} /></dd></div>)}</dl>
        </SettingsGroup>
      ))}
    </>
  );
}

/**
 * Settings (docs/rewrite/09-shells.md, #426): the person's pages (appearance, account, shortcuts),
 * the project's (Project, properties, naming patterns, extensions) and all projects. Each page is a
 * file in its root's Settings folder; opening one (or a property, a naming pattern, the preferences)
 * shows its page here.
 */
export function SettingsApp({ win, projectId, setTitle, setRoute }: AppProps) {
  const st = win.state as { tab?: string; open?: ResourceRef } | undefined;
  const asked = st?.tab;
  const { files } = store.useRoot({ project: projectId });
  const home = store.useRoot("home");
  const tabOf = (r: ResourceRef | null): Tab | null => {
    if (!r) return null;
    if (r.type === "property") return "properties";
    if (r.type === "naming") return "naming";
    if (r.type === "preferences") return "appearance";
    const f = [...(files ?? []), ...(home.files ?? [])].find((x) => x.id === r.id);
    return PAGE_TAB[(f?.body as { page?: string } | undefined)?.page ?? ""] ?? null;
  };
  const named = (): Tab => tabOf(st?.open ?? null) ?? (isTab(asked) ? asked : "appearance");
  const [tab, setTab] = useState<Tab>(named);
  // Launched again (a link, a page file opened): the page it names, or the first one; a file's page once the files are there.
  useEffect(() => { if (win.stateSeq) setTab(named()); }, [win.stateSeq]);
  useEffect(() => { const t = tabOf(st?.open ?? null); if (t) setTab(t); }, [!!files, !!home.files]);
  const project = useProjects().list?.find((p) => p.id === projectId);
  const wsList = useWorkspaceList();
  const wsOpen = tab.startsWith("ws:") ? wsList.list?.find((w) => w.id === tab.slice(3)) : undefined;
  const titleOf = (t: Tab) => (t === "general" ? project?.name ?? "Project" : t.startsWith("ws:") ? wsOpen?.name ?? "Workspace" : TITLE[t as (typeof TABS)[number]]);
  useEffect(() => { setTitle(`Settings · ${titleOf(tab)}`); setRoute(tab === "appearance" ? "" : tab); }, [tab, project?.name, wsOpen?.name]);
  const [theme, setTheme] = useTheme();
  const prefs = usePrefs();
  const saved = usePrefsState();
  const instance = useInstance();
  return (
    <SettingsLayout value={tab} onChange={(id) => setTab(id as Tab)} title={titleOf(tab)} wide={tab === "properties" || tab === "naming"}
      sections={[
        { label: "You", items: [{ id: "appearance", label: "Appearance", icon: "palette" }, { id: "account", label: "Account", icon: "user" }, { id: "shortcuts", label: "Shortcuts", icon: "keyboard" }, { id: "about", label: "About", icon: "info" }] },
        { label: "Workspaces", items: [{ id: "workspaces", label: "All workspaces", icon: "users" }, ...(wsList.list ?? []).map((w) => ({ id: `ws:${w.id}`, label: w.name, icon: (w.personal ? "user" : "users") as "user" | "users" }))] },
        { label: "This project", items: [{ id: "general", label: "General", icon: "slate" }, { id: "properties", label: "Properties", icon: "tag" }, { id: "naming", label: "Naming patterns", icon: "edit" }, { id: "extensions", label: "Extensions", icon: "extension" }, { id: "customizations", label: "Customizations", icon: "sliders" }] },
        { label: "All projects", items: [{ id: "projects", label: "Projects", icon: "files" }] },
      ]}>
      {(PROJECT_TABS as readonly string[]).includes(tab) && <ProjectPage tab={tab as ProjectTab} winId={win.id} projectId={projectId} />}
      {tab === "appearance" && (
        <>
          <SettingsGroup title="Theme">
            <FormField label="Colours"><span><Segmented label="Theme" value={theme} onChange={(v) => setTheme(v as Theme)} options={THEMES.map((t) => ({ value: t, label: t === "auto" ? "As the system" : t === "light" ? "Light" : "Dark", icon: t === "auto" ? "desktop" : t === "light" ? "sun" : "moon" }))} /></span></FormField>
          </SettingsGroup>
          <SettingsGroup title="Taskbar">
            <FormField label="Position"><span><Segmented label="Taskbar position" value={prefs.taskbarEdge} onChange={(v) => setPrefs({ taskbarEdge: v as Edge })} options={[{ value: "bottom", label: "Bottom" }, { value: "top", label: "Top" }, { value: "left", label: "Left" }, { value: "right", label: "Right" }]} /></span></FormField>
            <FormField label="Apps and windows" hint="Along a side bar, the start is its top."><span><Segmented label="Taskbar alignment" value={prefs.taskbarAlign} onChange={(v) => setPrefs({ taskbarAlign: v as "start" | "center" })} options={[{ value: "start", label: "At the start" }, { value: "center", label: "Centred" }]} /></span></FormField>
          </SettingsGroup>
          <p className="st-note">{saved === "unsaved" ? "Not saved to your account yet: the server could not be reached. It is kept in this browser and saved when it answers again." : "These follow your account to every browser. Window layouts stay with the browser, because they depend on the screen."}</p>
          <SettingsGroup title="Media">
            <FormField label="How a collection's colour shows on its photos"><span><Segmented label="Collection mark" value={prefs.collectionMark} onChange={(v) => setPrefs({ collectionMark: v as typeof prefs.collectionMark })} options={[{ value: "bar", label: "Bar below" }, { value: "barleft", label: "Bar left" }, { value: "dot", label: "Dot" }, { value: "frame", label: "Frame" }]} /></span></FormField>
          </SettingsGroup>
          <SettingsGroup title="Canvas">
            <Switch checked={prefs.canvasTakesFrame} onChange={(v) => setPrefs({ canvasTakesFrame: v })}>A canvas made from a photo starts with the frame the photo was taken with</Switch>
          </SettingsGroup>
          <SettingsGroup title="Desktop">
            <Switch checked={prefs.binOnDesktop} onChange={(v) => setPrefs({ binOnDesktop: v })}>Recycle bin on the desktop</Switch>
          </SettingsGroup>
        </>
      )}
      {tab === "account" && <AccountPage />}
      {tab === "workspaces" && <WorkspacesPage list={wsList.list} error={wsList.error} reload={wsList.reload} onOpen={(id) => setTab(`ws:${id}`)} />}
      {wsOpen && <WorkspacePage ws={wsOpen} onChanged={wsList.reload} />}
      {tab === "shortcuts" && <ShortcutList />}
      {tab === "about" && (
        <SettingsGroup title="OpenClapper Studio">
          <dl className="st-keys">
            <div><dt>Version</dt><dd>{__OPENCLAPPER_VERSION__}</dd></div>
            <div><dt>Build</dt><dd>{__OPENCLAPPER_COMMIT__}</dd></div>
            <div><dt>Instance</dt><dd>{instance || "production"}</dd></div>
          </dl>
        </SettingsGroup>
      )}
    </SettingsLayout>
  );
}
