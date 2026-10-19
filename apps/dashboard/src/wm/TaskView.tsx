import { useEffect, useRef, useState } from "preact/hooks";
import { appDef } from "../apps/registry";
import { cx, Icon, IconButton } from "../ui";
import { requestClose } from "./closeGuards";
import * as wm from "./wm";
import type { Rect, Win } from "./wm";

const TILE_W = 196;
const onKeyStub = (_e: KeyboardEvent) => {};
const WIN_DRAG = "application/x-fielder-window";

/** Where a window sits on its workspace, in desktop pixels (what the miniature draws). */
function frameOf(w: Win, view: { w: number; h: number }, split: number): Rect | null {
  if (w.mode === "min") return null;
  if (w.mode === "max") return { x: 0, y: 0, w: view.w, h: view.h };
  if (w.mode === "snapped") return w.snap === "left" ? { x: 0, y: 0, w: view.w * split, h: view.h } : { x: view.w * split, y: 0, w: view.w * (1 - split), h: view.h };
  return w.bounds;
}

/**
 * Task view (epic #90, like Windows' Win+Tab): the workspaces as tiles with a wireframe of their
 * windows, and the windows of the one under the pointer as cards. Click a tile to go there, a card
 * to bring that window up; drag a card onto a tile to move the window; double-click a name to
 * rename; × removes a workspace (its windows go to the one before). Esc leaves.
 */
export function TaskView({ onClose }: { onClose: () => void }) {
  const spaces = wm.useWorkspaces();
  const active = wm.useActiveWs();
  const all = wm.useAllWindows();
  const view = wm.getViewport();
  const [shown, setShown] = useState(active);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  // While a card is dragged the cards must stay as they are (re-rendering the source cancels the drop).
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const shownWs = spaces.some((s) => s.id === shown) ? shown : active;
  const cards = all.filter((w) => w.ws === shownWs).sort((a, b) => b.z - a.z);
  useEffect(() => { root.current?.focus(); }, []);
  // Keys from anywhere while it is open (focus may sit on the body after a rename).
  const keyRef = useRef(onKeyStub);
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);
  useEffect(() => { setCursor((c) => Math.min(c, Math.max(0, cards.length - 1))); }, [cards.length]);
  useEffect(() => { root.current?.querySelectorAll<HTMLElement>(".wm-taskview__card")[cursor]?.focus(); }, [cursor, shownWs]);

  const go = (id: string) => { wm.switchWorkspace(id); onClose(); };
  const bring = (w: Win) => { wm.focus(w.id); onClose(); };
  const scale = TILE_W / Math.max(1, view.w);

  const onKey = (e: KeyboardEvent) => {
    if (renaming || (e.target as HTMLElement | null)?.tagName === "INPUT") return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(cards.length - 1, c + 1)); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === "Enter" && cards[cursor]) { e.preventDefault(); bring(cards[cursor]); }
    else if (e.key === "Delete" && cards[cursor]) { e.preventDefault(); void requestClose(cards[cursor].id); }
  };
  keyRef.current = onKey;

  return (
    <div ref={root} class="wm-taskview" role="dialog" aria-label="Task view" tabIndex={-1} data-overlay
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="wm-taskview__strip" role="list" aria-label="Workspaces">
        {spaces.map((s, i) => {
          const split = s.split ?? 0.5;
          const mine = all.filter((w) => w.ws === s.id).sort((a, b) => a.z - b.z);
          return (
            <div key={s.id} role="listitem" class={cx("wm-taskview__tile", s.id === active && "is-active", s.id === shownWs && "is-shown", dropOn === s.id && "is-drop")}
              onMouseEnter={(e) => { if (!dragging && e.buttons === 0) setShown(s.id); }}
              onDragOver={(e) => { if (e.dataTransfer?.types.includes(WIN_DRAG)) { e.preventDefault(); setDropOn(s.id); } }}
              onDragLeave={() => setDropOn((d) => (d === s.id ? null : d))}
              onDrop={(e) => { e.preventDefault(); setDropOn(null); const id = e.dataTransfer?.getData(WIN_DRAG); if (id) wm.moveToWorkspace(id, s.id); }}>
              <div class="wm-taskview__head">
                {renaming === s.id ? (
                  <input class="wm-taskview__rename" autoFocus defaultValue={s.name} aria-label="Workspace name" maxLength={40}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") { wm.renameWorkspace(s.id, (e.target as HTMLInputElement).value); setRenaming(null); }
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={(e) => { wm.renameWorkspace(s.id, (e.target as HTMLInputElement).value); setRenaming(null); }} />
                ) : (
                  <span class="wm-taskview__name" title="Double-click to rename" onDblClick={() => setRenaming(s.id)}>{s.name}{i < 9 && <small class="num"> ⌘Alt{i + 1}</small>}</span>
                )}
                {spaces.length > 1 && <IconButton icon="close" label={`Remove ${s.name} (its windows go to the one before)`} class="wm-taskview__x" onClick={() => wm.removeWorkspace(s.id)} />}
              </div>
              <button type="button" class="wm-taskview__mini" style={{ width: `${TILE_W}px`, height: `${Math.round(view.h * scale)}px` }} aria-label={`Go to ${s.name}`} onClick={() => go(s.id)}>
                {mine.map((w) => {
                  const r = frameOf(w, view, split);
                  if (!r) return null;
                  return (
                    <span key={w.id} class="wm-taskview__miniwin" style={{ left: `${r.x * scale}px`, top: `${r.y * scale}px`, width: `${Math.max(8, r.w * scale)}px`, height: `${Math.max(6, r.h * scale)}px` }}>
                      <Icon name={appDef(w.app)?.icon ?? "application-outline"} size={10} />
                    </span>
                  );
                })}
              </button>
            </div>
          );
        })}
        <button type="button" class="wm-taskview__tile wm-taskview__add" onClick={() => setShown(wm.addWorkspace())}
          onDragOver={(e) => { if (e.dataTransfer?.types.includes(WIN_DRAG)) { e.preventDefault(); setDropOn("new"); } }}
          onDragLeave={() => setDropOn((d) => (d === "new" ? null : d))}
          onDrop={(e) => { e.preventDefault(); setDropOn(null); const id = e.dataTransfer?.getData(WIN_DRAG); if (id) wm.moveToWorkspace(id, "new"); }}>
          <span class="wm-taskview__head"><span class="wm-taskview__name">New workspace</span></span>
          <span class={cx("wm-taskview__plus", dropOn === "new" && "is-drop")} style={{ width: `${TILE_W}px`, height: `${Math.round(view.h * scale)}px` }}><Icon name="plus" size={28} /></span>
        </button>
      </div>
      <div class="wm-taskview__cards" role="list" aria-label={`Windows on ${spaces.find((s) => s.id === shownWs)?.name ?? ""}`}>
        {cards.length === 0 && <p class="wm-taskview__empty">No windows on {spaces.find((s) => s.id === shownWs)?.name}.</p>}
        {cards.map((w, i) => (
          <div key={w.id} role="listitem" class="wm-taskview__cardwrap">
            {/* A div, not a button: browsers do not start a drag from a <button>. */}
            <div role="button" tabIndex={0} class={cx("wm-taskview__card", i === cursor && "is-cursor", w.mode === "min" && "is-min")} draggable
              onDragStart={(e) => { e.dataTransfer?.setData(WIN_DRAG, w.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; setDragging(true); }}
              onDragEnd={() => setDragging(false)}
              onFocus={() => setCursor(i)} onClick={() => bring(w)} title={w.mode === "min" ? `${w.title} (minimized)` : w.title}>
              <span class="wm-taskview__cardhead"><Icon name={appDef(w.app)?.icon ?? "application-outline"} /><span class="wm-taskview__cardtitle">{w.title}</span></span>
              <span class="wm-taskview__cardbody"><Icon name={appDef(w.app)?.icon ?? "application-outline"} size={44} /></span>
            </div>
            <IconButton icon="close" label={`Close ${w.title}`} class="wm-taskview__cardx" onClick={() => void requestClose(w.id)} />
          </div>
        ))}
      </div>
      <p class="wm-taskview__hint">Drag a window onto a workspace to move it · double-click a name to rename · Esc to leave</p>
    </div>
  );
}
