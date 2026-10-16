import { useEffect, useRef } from "preact/hooks";
import { appDef, launch } from "../apps/registry";
import { ConfirmHost, ToastHost } from "../ui";
import { Desktop } from "./Desktop";
import * as desktopState from "./desktopState";
import { Taskbar } from "./Taskbar";
import { Window } from "./Window";
import * as wm from "./wm";

/**
 * The desktop shell (replaces App in main.tsx, epic #72): desktop layer, windows, snap preview
 * and taskbar. The real project store lands in phase 2; until then the stored scope id keys the
 * per-project desktop persistence.
 */

function storedProjectId(): string {
  try { return localStorage.getItem("project") ?? "default"; } catch { return "default"; }
}

export function Shell() {
  const area = useRef<HTMLDivElement>(null);
  const windows = wm.useWindows();
  const focusedId = wm.useFocusedId();
  const preview = wm.useSnapPreview();

  useEffect(() => {
    const projectId = storedProjectId();
    const el = area.current!;
    wm.setViewport({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(() => wm.setViewport({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    const stored = desktopState.load(projectId);
    if (stored) {
      // Windows of apps this build no longer knows are dropped; min sizes come from the registry.
      wm.hydrate({ ...stored, windows: stored.windows.filter((w) => appDef(w.app)).map((w) => ({ ...w, min: appDef(w.app)!.minSize })) });
    } else {
      launch({ app: "settings" });
    }
    const unsub = wm.subscribe(() => desktopState.save(projectId, wm.snapshot()));
    const flush = () => desktopState.flush();
    window.addEventListener("pagehide", flush);
    return () => { unsub(); ro.disconnect(); window.removeEventListener("pagehide", flush); desktopState.flush(); };
  }, []);

  return (
    <div class="wm-root">
      <div ref={area} class="wm-area">
        <Desktop />
        {windows.map((w) => {
          const def = appDef(w.app);
          if (!def) return null;
          const Comp = def.component;
          return (
            <Window key={w.id} win={w} icon={def.icon} focused={w.id === focusedId}>
              <Comp win={w} focused={w.id === focusedId} resource={w.resource} setTitle={(t) => wm.setTitle(w.id, t)}
                replaceRoute={() => { /* the route bridge lands in phase 2 */ }}
                open={(intent) => launch(intent)} close={() => wm.close(w.id)} />
            </Window>
          );
        })}
        {preview && <div class={`wm-snap-preview wm-snap-preview--${preview}`} />}
      </div>
      <Taskbar />
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}
