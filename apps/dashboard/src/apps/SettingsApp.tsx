import { useEffect, useState } from "preact/hooks";
import { isFrameMode } from "../format";
import type { MaskMode } from "../Framed";
import { parseRoute, type SettingsTab } from "../router";
import { SettingsPage } from "../SettingsPage";
import { useTheme } from "../theme";
import type { AppProps } from "./registry";

function loadMask(): MaskMode { try { const v = localStorage.getItem("maskMode"); return isFrameMode(v) ? v : "mask"; } catch { return "mask"; } }

/** The tab a launch asked for (#/settings/shortcuts), else the one the window last showed. */
function tabOf(win: AppProps["win"]): SettingsTab {
  const asked = (win.state as { tab?: SettingsTab } | undefined)?.tab;
  if (asked) return asked;
  const r = win.route ? parseRoute(win.route) : null;
  return r?.page === "settings" ? r.tab : "general";
}

/**
 * Settings in a window. The frame mode is still owned by App.tsx for the old pages; this writes
 * the same localStorage key, and the global mode state moves into a store with phase 4.
 */
export function SettingsApp({ win, replaceRoute }: AppProps) {
  const [tab, setTabState] = useState<SettingsTab>(() => tabOf(win));
  const [theme, setTheme] = useTheme();
  const [mask, setMaskState] = useState<MaskMode>(loadMask);
  const setTab = (t: SettingsTab) => { setTabState(t); replaceRoute({ page: "settings", tab: t }); };
  // Re-launched with a tab (a deep link while the window is open).
  useEffect(() => { if (win.stateSeq) setTab(tabOf(win)); }, [win.stateSeq]);
  useEffect(() => { replaceRoute({ page: "settings", tab }); }, []);
  const setMask = (m: MaskMode) => { setMaskState(m); try { localStorage.setItem("maskMode", m); } catch { /* a preference */ } };
  return <SettingsPage tab={tab} onTab={setTab} theme={theme} onTheme={setTheme} mask={mask} onMask={setMask} />;
}
