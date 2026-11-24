import { useEffect, useState } from "preact/hooks";
import { Avatar, Button, FormField, Kbd, Segmented, SettingsGroup, SettingsLayout, Switch } from "@openclapper/design";
import { useInstance } from "../instance";
import { setPrefs, usePrefs, type Edge } from "../prefs";
import { SCOPES, keysLabel, shortcutsOf, type ScopeId } from "../shortcuts";
import { THEMES, useTheme, type Theme } from "../theme";
import { signOut, useUser } from "../user";
import type { AppProps } from "./registry";

const TABS = ["appearance", "account", "shortcuts", "about"] as const;
type Tab = (typeof TABS)[number];
const TITLE: Record<Tab, string> = { appearance: "Appearance", account: "Account", shortcuts: "Keyboard shortcuts", about: "About" };

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

/** Preferences and the account (docs/rewrite/09-shells.md). */
export function SettingsApp({ win, setTitle, setRoute }: AppProps) {
  const asked = (win.state as { tab?: string } | undefined)?.tab;
  const [tab, setTab] = useState<Tab>(TABS.includes(asked as Tab) ? (asked as Tab) : "appearance");
  useEffect(() => { if (TABS.includes(asked as Tab)) setTab(asked as Tab); }, [win.stateSeq]);
  useEffect(() => { setTitle(`Settings · ${TITLE[tab]}`); setRoute(tab === "appearance" ? "" : tab); }, [tab]);
  const [theme, setTheme] = useTheme();
  const prefs = usePrefs();
  const user = useUser();
  const instance = useInstance();
  const me = user.status === "signed-in" ? user.me : null;
  return (
    <SettingsLayout value={tab} onChange={(id) => setTab(id as Tab)} title={TITLE[tab]}
      sections={[{ items: [{ id: "appearance", label: "Appearance", icon: "palette" }, { id: "account", label: "Account", icon: "user" }, { id: "shortcuts", label: "Shortcuts", icon: "keyboard" }, { id: "about", label: "About", icon: "info" }] }]}>
      {tab === "appearance" && (
        <>
          <SettingsGroup title="Theme">
            <FormField label="Colours"><span><Segmented label="Theme" value={theme} onChange={(v) => setTheme(v as Theme)} options={THEMES.map((t) => ({ value: t, label: t === "auto" ? "As the system" : t === "light" ? "Light" : "Dark", icon: t === "auto" ? "desktop" : t === "light" ? "sun" : "moon" }))} /></span></FormField>
          </SettingsGroup>
          <SettingsGroup title="Taskbar">
            <FormField label="Position"><span><Segmented label="Taskbar position" value={prefs.taskbarEdge} onChange={(v) => setPrefs({ taskbarEdge: v as Edge })} options={[{ value: "bottom", label: "Bottom" }, { value: "top", label: "Top" }, { value: "left", label: "Left" }, { value: "right", label: "Right" }]} /></span></FormField>
            <FormField label="Apps and windows" hint="Along a side bar, the start is its top."><span><Segmented label="Taskbar alignment" value={prefs.taskbarAlign} onChange={(v) => setPrefs({ taskbarAlign: v as "start" | "center" })} options={[{ value: "start", label: "At the start" }, { value: "center", label: "Centred" }]} /></span></FormField>
          </SettingsGroup>
          <SettingsGroup title="Desktop">
            <Switch checked={prefs.binOnDesktop} onChange={(v) => setPrefs({ binOnDesktop: v })}>Recycle bin on the desktop</Switch>
          </SettingsGroup>
        </>
      )}
      {tab === "account" && me && (
        <SettingsGroup title="Signed in">
          <span className="st-inline"><Avatar name={me.user.name ?? me.user.email} /><span><strong>{me.user.name ?? me.user.email}</strong><br /><span className="st-note">{me.user.email}</span></span></span>
          <dl className="st-keys">{me.workspaces.map((w) => <div key={w.id}><dt>{w.name}{w.personal ? " (personal)" : ""}</dt><dd>{w.role}</dd></div>)}</dl>
          <span><Button icon="logout" onClick={() => void signOut()}>Sign out</Button></span>
        </SettingsGroup>
      )}
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
