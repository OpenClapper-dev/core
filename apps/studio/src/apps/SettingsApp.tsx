import { useEffect, useState } from "preact/hooks";
import { FormField, Kbd, Segmented, SettingsGroup, SettingsLayout, Switch } from "@openclapper/design";
import { useInstance } from "../instance";
import { setPrefs, usePrefs, usePrefsState, type Edge } from "../prefs";
import { SCOPES, keysLabel, shortcutsOf, type ScopeId } from "../shortcuts";
import { THEMES, useTheme, type Theme } from "../theme";
import { AccountPage } from "./AccountPage";
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
  // Launched again (a link, the palette): the tab it names, or the first one.
  useEffect(() => { if (win.stateSeq) setTab(TABS.includes(asked as Tab) ? (asked as Tab) : TABS[0]); }, [win.stateSeq]);
  useEffect(() => { setTitle(`Settings · ${TITLE[tab]}`); setRoute(tab === "appearance" ? "" : tab); }, [tab]);
  const [theme, setTheme] = useTheme();
  const prefs = usePrefs();
  const saved = usePrefsState();
  const instance = useInstance();
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
