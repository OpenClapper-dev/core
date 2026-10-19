import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { fetchServerBuild, type ServerBuild } from "./api";
import { AccountSettings } from "./AccountSettings";
import { FRAME_MODES, frameModeLabel } from "./format";
import type { MaskMode } from "./Framed";
import { DEFAULT_SETTINGS, updateSettings, useSettings } from "./settings";
import { ShortcutList } from "./CommandPalette";
import type { SettingsTab } from "./router";
import type { ThemeChoice } from "./theme";
import { Icon, LinkButton, Seg, Toolbar, ToolbarTitle } from "./ui";

interface Props { tab: SettingsTab; onTab: (t: SettingsTab) => void; theme: ThemeChoice; onTheme: (t: ThemeChoice) => void; mask: MaskMode; onMask: (m: MaskMode) => void }

/** Settings (route #/settings): dashboard preferences, saved on change, per browser; the account and workspaces (#/settings/account); the shortcut reference (#/settings/shortcuts). */
export function SettingsPage({ tab, onTab, theme, onTheme, mask, onMask }: Props) {
  const s = useSettings();
  const tabs = <Seg label="Settings section" value={tab} onChange={onTab} options={[{ id: "general", label: "General" }, { id: "account", label: "Account" }, { id: "shortcuts", label: "Shortcuts" }]} />;
  if (tab === "account") {
    return (
      <>
        <Toolbar><ToolbarTitle icon="cog-outline">Settings</ToolbarTitle>{tabs}<span class="meta">Your account, workspaces and their members</span></Toolbar>
        <div class="f-scroll"><AccountSettings /></div>
      </>
    );
  }
  if (tab === "shortcuts") {
    return (
      <>
        <Toolbar><ToolbarTitle icon="cog-outline">Settings</ToolbarTitle>{tabs}<span class="meta">Every keyboard shortcut, from the registry the pages use. Not rebindable yet.</span></Toolbar>
        <div class="f-scroll"><div class="shortcut-grid settings__shortcuts"><ShortcutList /></div></div>
      </>
    );
  }
  return (
    <>
      <Toolbar><ToolbarTitle icon="cog-outline">Settings</ToolbarTitle>{tabs}<span class="meta">Saved on change, in this browser</span></Toolbar>
      <div class="f-scroll">
        <div class="settings">
          <Section icon="theme-light-dark" title="Appearance">
            <Row label="Theme" help="Auto follows the system. Sun is light for daylight, Set is dark for a dark set.">
              <Seg label="Theme" value={theme} onChange={onTheme} options={[{ id: "auto", label: "Auto" }, { id: "sun", label: "Sun" }, { id: "set", label: "Set" }]} />
            </Row>
            <Row label="Frame mode" help="How the rig frame is drawn on photos in Shots, Plan and when a shot opens (M cycles it).">
              <Seg label="Frame mode" value={mask} onChange={onMask} options={FRAME_MODES.map((m) => ({ id: m, label: frameModeLabel(m) }))} />
            </Row>
          </Section>
          <Section icon="monitor" title="Desktop">
            <Row label="Recycle bin on the desktop" help="An icon you can drop files on and open. Off, the recycle bin is still in Files, at the bottom of its side bar.">
              <Seg label="Recycle bin on the desktop" value={s.binOnDesktop ? "on" : "off"} onChange={(v) => updateSettings({ binOnDesktop: v === "on" })} options={[{ id: "on", label: "Show" }, { id: "off", label: "Hide" }]} />
            </Row>
            <Row label="Taskbar position" help="Any edge of the screen. On the left or right it is a narrow bar of icons (hover one for its name). Menus and notifications follow it.">
              <Seg label="Taskbar position" value={s.taskbarPosition} onChange={(v) => updateSettings({ taskbarPosition: v })} options={[{ id: "bottom", label: "Bottom" }, { id: "top", label: "Top" }, { id: "left", label: "Left" }, { id: "right", label: "Right" }]} />
            </Row>
            <Row label="Taskbar alignment" help="The launcher, pins and open windows from the start (left, or top on a side bar), or in the middle like Windows 11. Project, search, theme and clock stay at the end.">
              <Seg label="Taskbar alignment" value={s.taskbarAlign} onChange={(v) => updateSettings({ taskbarAlign: v })} options={[{ id: "start", label: "Left" }, { id: "center", label: "Centre" }]} />
            </Row>
          </Section>
          <Section icon="image-plus" title="New shot">
            <Row label="Review state" help="Shots made with New shot (uploaded or drawn) start in this state. The dialog can still change it per shot.">
              <Seg label="Review state of new shots" value={s.newShotState} onChange={(v) => updateSettings({ newShotState: v })} options={[{ id: "approved", label: "Approved" }, { id: "unreviewed", label: "To review" }]} />
            </Row>
          </Section>
          <Section icon="filmstrip" title="Timeline">
            <Row label="Open overlays right away" help="Landing on a clip that shows an overlay opens it in the inline editor, no C needed. Moving to another clip then always ends the edit (saved first), whatever the playhead setting below says.">
              <Seg label="Open overlays right away" value={s.autoOverlay ? "on" : "off"} onChange={(v) => updateSettings({ autoOverlay: v === "on" })} options={[{ id: "off", label: "Off" }, { id: "on", label: "On" }]} />
            </Row>
            <Row label="Playhead while editing" help={`When a clip is re-framed or drawn on inline. Pinned: the playhead stays on that clip until you are done. Leave: selecting, stepping or scrubbing to another clip ends the edit (saved first).${s.autoOverlay ? " With overlays opening right away, it always leaves." : ""}`}>
              <Seg label="Playhead while editing a clip" value={s.inlinePlayhead} onChange={(v) => updateSettings({ inlinePlayhead: v })} options={[{ id: "pin", label: "Pinned to the clip" }, { id: "leave", label: "Leave ends the edit" }]} />
            </Row>
            <Row label="Removing a sequence's photo" help="Remove on a clip of a sequence block. Just the photo: the block keeps the rest in order (Restore all photos brings it back). Whole sequence: the block goes.">
              <Seg label="Removing a sequence's photo" value={s.seqRemove} onChange={(v) => updateSettings({ seqRemove: v })} options={[{ id: "photo", label: "Just the photo" }, { id: "block", label: "Whole sequence" }]} />
            </Row>
          </Section>
          <About />
          <LinkButton onClick={() => updateSettings(DEFAULT_SETTINGS)}>Reset these settings</LinkButton>
        </div>
      </div>
    </>
  );
}

const REPO = "https://github.com/bubulux/fielder";

/** Which version this dashboard is and which the server runs: they differ while a deploy is new and this tab still has the old bundle. */
function About() {
  const [server, setServer] = useState<ServerBuild | null | undefined>(undefined);
  useEffect(() => { fetchServerBuild().then(setServer, () => setServer(null)); }, []);
  const label = (b: ServerBuild) => `${b.version} (${b.commit})`;
  const dashboard = { version: __FIELDER_VERSION__, commit: __FIELDER_COMMIT__ };
  // "dev" is a local Worker, which has no commit to compare.
  const stale = server && (server.version !== dashboard.version || (server.commit !== "dev" && server.commit !== dashboard.commit));
  return (
    <Section icon="information-outline" title="About">
      <Row label="Dashboard" help="The version of this page. Alpha: everything may still change.">
        <span class="num">{label(dashboard)}</span>
      </Row>
      <Row label="Server" help={stale ? "Another version than this page: reload to get the server's." : "The version the server runs."}>
        <span class="num">{server === undefined ? "…" : server ? label(server) : "not reachable"}</span>
      </Row>
      <Row label="Release notes" help="What changed in each version.">
        <a href={`${REPO}/releases`} target="_blank" rel="noreferrer">GitHub releases</a>
      </Row>
    </Section>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: ComponentChildren }) {
  return <section class="settings__sec"><h2><Icon name={icon} />{title}</h2>{children}</section>;
}
function Row({ label, help, children }: { label: string; help: string; children: ComponentChildren }) {
  return <div class="settings__row"><div><strong>{label}</strong><span class="meta">{help}</span></div><div>{children}</div></div>;
}
