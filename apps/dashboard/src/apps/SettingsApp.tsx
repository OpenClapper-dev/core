import { useEffect, useState } from "preact/hooks";
import { useMask } from "../frameMode";
import { parseRoute, type SettingsTab } from "../router";
import { SettingsPage } from "../SettingsPage";
import { useTheme } from "../theme";
import type { AppProps } from "./registry";

/** The tab a launch asked for (#/settings/shortcuts), else the one the window last showed. */
function tabOf(win: AppProps["win"]): SettingsTab {
  const asked = (win.state as { tab?: SettingsTab } | undefined)?.tab;
  if (asked) return asked;
  const r = win.route ? parseRoute(win.route) : null;
  return r?.page === "settings" ? r.tab : "general";
}

/** Settings in a window (#/settings, #/settings/shortcuts). */
export function SettingsApp({ win, replaceRoute }: AppProps) {
  const [tab, setTabState] = useState<SettingsTab>(() => tabOf(win));
  const [theme, setTheme] = useTheme();
  const [mask, setMask] = useMask();
  const setTab = (t: SettingsTab) => { setTabState(t); replaceRoute({ page: "settings", tab: t }); };
  // Re-launched with a tab (a deep link while the window is open).
  useEffect(() => { if (win.stateSeq) setTab(tabOf(win)); }, [win.stateSeq]);
  useEffect(() => { replaceRoute({ page: "settings", tab }); }, []);
  return <SettingsPage tab={tab} onTab={setTab} theme={theme} onTheme={setTheme} mask={mask} onMask={setMask} />;
}
