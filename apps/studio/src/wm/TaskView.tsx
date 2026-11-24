import { useLayoutEffect, useRef } from "preact/hooks";
import { AppIcon, TaskView as TaskViewPanel } from "@openclapper/design";
import { appDef } from "../apps/registry";
import { requestClose } from "./closeGuards";
import * as wm from "./wm";
import type { Rect, Win } from "./wm";
import { contentOf, contentSize, snapshot } from "./windowPreview";

/** Where a window sits on its desktop, in desktop pixels (what the miniature draws). */
function frameOf(w: Win, view: { w: number; h: number }, split: number): Rect | null {
  if (w.mode === "min") return null;
  if (w.mode === "max") return { x: 0, y: 0, w: view.w, h: view.h };
  if (w.mode === "snapped") return w.snap === "left" ? { x: 0, y: 0, w: view.w * split, h: view.h } : { x: view.w * split, y: 0, w: view.w * (1 - split), h: view.h };
  return w.bounds;
}

/**
 * What a window shows, as a picture: a copy of its content laid out at the window's own size,
 * scaled to fit its host and centred, `inert` so the card stays the only target.
 */
function WindowPreview({ win, frame }: { win: Win; frame: Rect }) {
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const host = box.current;
    const content = contentOf(win.id);
    const size = content && contentSize(content, frame);
    if (!host || !content || !size) return;
    const k = Math.min(host.clientWidth / size.w, host.clientHeight / size.h);
    const copy = snapshot(content);
    Object.assign(copy.style, {
      position: "absolute", width: `${size.w}px`, height: `${size.h}px`, transformOrigin: "0 0", transform: `scale(${k})`,
      left: `${(host.clientWidth - size.w * k) / 2}px`, top: `${(host.clientHeight - size.h * k) / 2}px`,
    });
    host.replaceChildren(copy);
    return () => host.replaceChildren();
  }, [win.id, frame.w, frame.h]);
  return <span ref={box} className="st-shot" inert aria-hidden="true" />;
}

/**
 * Task view (like Windows' Win+Tab): every desktop with a miniature of its windows, and the windows
 * of the one under the pointer as cards with a picture of what they show.
 */
export function TaskView({ onClose }: { onClose: () => void }) {
  const desks = wm.useDesks();
  const active = wm.useActiveDesk();
  const all = wm.useAllWindows();
  const view = wm.getViewport();
  const frame = (w: Win) => frameOf(w, view, desks.find((d) => d.id === w.desk)?.split ?? 0.5);
  return (
    <TaskViewPanel data-overlay current={active} aspect={view.h / Math.max(1, view.w)} onClose={onClose}
      desks={desks.map((d, i) => ({
        id: d.id, label: d.name, hint: i < 9 ? `⌘Alt${i + 1}` : undefined,
        windows: all.filter((w) => w.desk === d.id).sort((a, b) => (d.id === active ? b.z - a.z : a.z - b.z)).map((w) => {
          const f = frame(w);
          const def = appDef(w.app);
          return { id: w.id, title: w.title, minimized: w.mode === "min", icon: def && <AppIcon glyph={def.glyph} color={def.color} size={16} />, box: f && { x: f.x / view.w, y: f.y / view.h, w: f.w / view.w, h: f.h / view.h } };
        }),
      }))}
      preview={(id) => { const w = all.find((x) => x.id === id); return w ? <WindowPreview win={w} frame={frame(w) ?? w.bounds} /> : null; }}
      onDesk={(id) => { wm.switchDesk(id); onClose(); }}
      onWindow={(id) => { wm.focus(id); onClose(); }}
      onAdd={() => { wm.addDesk(); }}
      onRename={wm.renameDesk} onRemove={wm.removeDesk}
      onCloseWindow={(id) => void requestClose(id)}
      onMoveWindow={wm.moveToDesk} />
  );
}
