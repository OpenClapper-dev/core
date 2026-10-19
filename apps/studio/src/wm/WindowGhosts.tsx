import { useEffect, useState } from "preact/hooks";
import { cx, Icon, reducedMotion } from "@fielder/ui";
import { appDef } from "../apps/registry";
import * as wm from "./wm";
import type { Win } from "./wm";

/**
 * A closed window fades out (epic #156, #162): the store drops it at once, so the shell draws an
 * empty frame with its title bar in its place, which motion.css fades and shrinks, and removes it
 * after --dur-slow. Only the frame: the app is gone, so nothing outlives the close guards.
 */
export function WindowGhosts({ activeWs }: { activeWs: string }) {
  const [ghosts, setGhosts] = useState<Win[]>([]);
  useEffect(() => wm.onClose((w) => {
    if (w.ws !== activeWs || w.mode === "min" || reducedMotion()) return;
    setGhosts((cur) => [...cur, w]);
    const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--dur-slow")) || 0;
    setTimeout(() => setGhosts((cur) => cur.filter((g) => g !== w)), ms + 40);
  }), [activeWs]);
  return (
    <>
      {ghosts.map((w) => (
        <div key={w.id} aria-hidden="true"
          class={cx("wm-window wm-window--ghost", w.mode === "max" && "wm-window--max", w.mode === "snapped" && `wm-window--snap-${w.snap}`)}
          style={w.mode === "normal" ? { left: `${w.bounds.x}px`, top: `${w.bounds.y}px`, width: `${w.bounds.w}px`, height: `${w.bounds.h}px`, zIndex: w.z } : { zIndex: w.z }}>
          <div class="wm-window__bar"><Icon name={appDef(w.app)?.icon ?? "application-outline"} /><span class="wm-window__title">{w.title}</span></div>
          <div class="wm-window__content" />
        </div>
      ))}
    </>
  );
}
