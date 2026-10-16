import { useEffect, useRef } from "preact/hooks";
import { beforeProjectSwitch } from "../project";
import { setCloseGuard } from "../wm/closeGuards";

/**
 * One guard for an app's unsaved work, asked before its window closes and before the project
 * (and with it the whole desktop) switches. `ask` resolves true to go ahead; it is only called
 * while `dirty`.
 */
export function useAppGuard(winId: string, dirty: boolean, ask: () => Promise<boolean>) {
  const ref = useRef(ask);
  ref.current = ask;
  useEffect(() => {
    if (!dirty) return;
    const run = () => ref.current();
    setCloseGuard(winId, run);
    const off = beforeProjectSwitch(run);
    return () => { setCloseGuard(winId, null); off(); };
  }, [winId, dirty]);
}
