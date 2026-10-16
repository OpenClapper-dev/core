import { useState } from "preact/hooks";
import { isFrameMode } from "../format";
import type { MaskMode } from "../Framed";
import type { SettingsTab } from "../router";
import { SettingsPage } from "../SettingsPage";
import { useTheme } from "../theme";
import type { AppProps } from "./registry";

function loadMask(): MaskMode { try { const v = localStorage.getItem("maskMode"); return isFrameMode(v) ? v : "mask"; } catch { return "mask"; } }

/**
 * Settings in a window. The frame mode is still owned by App.tsx for the old pages; this writes
 * the same localStorage key, and the global mode state moves into a store with phase 4.
 */
export function SettingsApp(_: AppProps) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [theme, setTheme] = useTheme();
  const [mask, setMaskState] = useState<MaskMode>(loadMask);
  const setMask = (m: MaskMode) => { setMaskState(m); try { localStorage.setItem("maskMode", m); } catch { /* a preference */ } };
  return <SettingsPage tab={tab} onTab={setTab} theme={theme} onTheme={setTheme} mask={mask} onMask={setMask} />;
}
