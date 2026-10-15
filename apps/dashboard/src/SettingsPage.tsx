import type { ComponentChildren } from "preact";
import { FRAME_MODES, frameModeLabel } from "./format";
import type { MaskMode } from "./Framed";
import { DEFAULT_SETTINGS, updateSettings, useSettings } from "./settings";
import { ShortcutList } from "./CommandPalette";
import type { SettingsTab } from "./router";
import type { ThemeChoice } from "./theme";
import { Icon, LinkButton, Seg, Toolbar, ToolbarTitle } from "./ui";

interface Props { tab: SettingsTab; onTab: (t: SettingsTab) => void; theme: ThemeChoice; onTheme: (t: ThemeChoice) => void; mask: MaskMode; onMask: (m: MaskMode) => void }

/** Settings (route #/settings): dashboard preferences, saved on change, per browser; and the shortcut reference (#/settings/shortcuts). */
export function SettingsPage({ tab, onTab, theme, onTheme, mask, onMask }: Props) {
  const s = useSettings();
  const tabs = <Seg label="Settings section" value={tab} onChange={onTab} options={[{ id: "general", label: "General" }, { id: "shortcuts", label: "Shortcuts" }]} />;
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
          <Section icon="image-plus" title="New shot">
            <Row label="Review state" help="Shots made with New shot (uploaded or drawn) start in this state. The dialog can still change it per shot.">
              <Seg label="Review state of new shots" value={s.newShotState} onChange={(v) => updateSettings({ newShotState: v })} options={[{ id: "approved", label: "Approved" }, { id: "unreviewed", label: "To review" }]} />
            </Row>
          </Section>
          <Section icon="filmstrip" title="Timeline">
            <Row label="Playhead while editing" help="When a clip is re-framed or drawn on inline. Pinned: the playhead stays on that clip until you are done. Leave: selecting, stepping or scrubbing to another clip ends the edit (saved first).">
              <Seg label="Playhead while editing a clip" value={s.inlinePlayhead} onChange={(v) => updateSettings({ inlinePlayhead: v })} options={[{ id: "pin", label: "Pinned to the clip" }, { id: "leave", label: "Leave ends the edit" }]} />
            </Row>
            <Row label="Removing a sequence's photo" help="Remove on a clip of a sequence block. Just the photo: the block keeps the rest in order (Restore all photos brings it back). Whole sequence: the block goes.">
              <Seg label="Removing a sequence's photo" value={s.seqRemove} onChange={(v) => updateSettings({ seqRemove: v })} options={[{ id: "photo", label: "Just the photo" }, { id: "block", label: "Whole sequence" }]} />
            </Row>
          </Section>
          <LinkButton onClick={() => updateSettings(DEFAULT_SETTINGS)}>Reset these settings</LinkButton>
        </div>
      </div>
    </>
  );
}

function Section({ icon, title, children }: { icon: string; title: string; children: ComponentChildren }) {
  return <section class="settings__sec"><h2><Icon name={icon} />{title}</h2>{children}</section>;
}
function Row({ label, help, children }: { label: string; help: string; children: ComponentChildren }) {
  return <div class="settings__row"><div><strong>{label}</strong><span class="meta">{help}</span></div><div>{children}</div></div>;
}
