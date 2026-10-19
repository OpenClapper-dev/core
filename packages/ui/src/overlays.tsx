/**
 * Overlays from the design system (overlays.css): the scrim overlay, the modal shell, the
 * anchored popover menu, and the confirm/prompt dialog hosted once in App.
 */
import type { ComponentChildren, Ref } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button } from "./actions";
import { cx } from "./core";
import { Field, Input } from "./forms";
import { useOutsideClick } from "./hooks";

/**
 * A full-window layer over the page with a scrim; a click on the scrim calls `onClose`.
 * `data-overlay` pauses the page's single-key shortcuts while it is open. `top` aligns the
 * content to the top (command palette) instead of centring it.
 */
export function Overlay({ top, onClose, onKeyDown, children }: { top?: boolean; onClose: () => void; onKeyDown?: (e: KeyboardEvent) => void; children: ComponentChildren }) {
  return (
    <div class={cx("overlay", top && "overlay--top")} data-overlay onKeyDown={onKeyDown}>
      <div class="f-scrim" onClick={onClose} />
      {children}
    </div>
  );
}

/**
 * Modal dialog (f-modal) on an Overlay: a heading with an optional action (a close button),
 * then the body and foot the caller passes as children (f-modal__body, f-modal__foot).
 */
export function Modal({ title, role = "dialog", width, onClose, onKeyDown, headAction, modalRef, tabIndex, children }: {
  title: string; role?: "dialog" | "alertdialog"; width?: string; onClose: () => void; onKeyDown?: (e: KeyboardEvent) => void;
  headAction?: ComponentChildren; modalRef?: Ref<HTMLDivElement>; tabIndex?: number; children?: ComponentChildren;
}) {
  return (
    <Overlay onClose={onClose} onKeyDown={onKeyDown}>
      <div class="f-modal" role={role} aria-modal="true" aria-label={title} style={width ? { width } : undefined} tabIndex={tabIndex} ref={modalRef}>
        <div class="f-modal__head"><h2 class="f-modal__title">{title}</h2>{headAction}</div>
        {children}
      </div>
    </Overlay>
  );
}

/** A small menu (f-menu) anchored under its button inside a .menu-anchor; closes on an outside press or Esc. */
export function Popover({ children, onClose, right }: { children: ComponentChildren; onClose: () => void; right?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useOutsideClick(() => box.current?.parentElement, onClose);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, []);
  return <div ref={box} class="f-menu popover" style={right ? { right: 0 } : { left: 0 }}>{children}</div>;
}

// ---------- Context menu (issue #31) ----------

/** Right-click state: where to open and what was clicked. Spread `openMenu` into onContextMenu handlers. */
export function useCtxMenu<T>() {
  const [menu, setMenu] = useState<{ x: number; y: number; ctx: T } | null>(null);
  const openMenu = (e: MouseEvent, ctx: T) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, ctx }); };
  return { menu, openMenu, closeMenu: () => setMenu(null) };
}

/**
 * An app context menu at the pointer (like a media pool's right-click), suppressing the browser's.
 * MenuItems as children; any click inside closes it, as do Esc, an outside press and a second
 * right-click. ↑/↓ move between items. `data-overlay` pauses the page's shortcuts while open.
 */
export function ContextMenu({ x, y, label, onClose, children }: { x: number; y: number; label?: string; onClose: () => void; children: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
    el.querySelector("button")?.focus();
  }, [x, y]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>(".f-menu__item:not(:disabled)") ?? [])];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };
  return (
    <div class="ctx" data-overlay onContextMenu={(e) => { e.preventDefault(); onClose(); }} onMouseDown={(e) => { if (!ref.current?.contains(e.target as Node)) onClose(); }}>
      <div ref={ref} class="f-menu ctx__menu" role="menu" aria-label={label ?? "Actions"} style={{ left: `${pos.left}px`, top: `${pos.top}px` }} onKeyDown={onKey} onClick={onClose}>
        {children}
      </div>
    </div>
  );
}

// ---------- Confirm dialog + toasts (hosted once in App) ----------

export interface ConfirmOptions {
  title: string;
  body?: ComponentChildren;
  confirmLabel: string;
  /** Destructive confirm: danger-solid. */
  danger?: boolean;
  /** An extra safe alternative (e.g. "Archive" next to "Delete"), resolves "alt". */
  altLabel?: string;
  cancelLabel?: string;
  /** Ask for a text (prompt mode): the confirm button resolves with the trimmed text. */
  input?: { label: string; value?: string; placeholder?: string };
}
type ConfirmReq = ConfirmOptions & { resolve: (v: boolean | "alt" | string) => void };
let showConfirm: ((r: ConfirmReq) => void) | null = null;

/** In-app confirmation (replaces window.confirm): resolves true, false (cancel) or "alt". */
export const confirmDialog = (o: Omit<ConfirmOptions, "input">) => new Promise<boolean | "alt">((resolve) => (showConfirm ? showConfirm({ ...o, resolve: (v) => resolve(v === "alt" ? "alt" : !!v) }) : resolve(window.confirm(o.title))));

/** In-app text prompt: resolves the entered text, or null when cancelled or empty. */
export const promptDialog = (o: ConfirmOptions & { input: NonNullable<ConfirmOptions["input"]> }) =>
  new Promise<string | null>((resolve) => (showConfirm ? showConfirm({ ...o, resolve: (v) => resolve(typeof v === "string" && v ? v : null) }) : resolve(window.prompt(o.title, o.input.value ?? "")?.trim() || null)));

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const [text, setText] = useState("");
  useEffect(() => { showConfirm = (r) => { setText(r.input?.value ?? ""); setReq(r); }; return () => { showConfirm = null; }; }, []);
  const done = (v: boolean | "alt") => { req?.resolve(v === true && req.input ? text.trim() : v); setReq(null); };
  const ok = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { if (req?.input) { field.current?.focus(); field.current?.select(); } else ok.current?.focus(); }, [req]);
  if (!req) return null;
  return (
    <Modal title={req.title} role="alertdialog" width="460px" onClose={() => done(false)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } }}>
      {(req.body || req.input) && (
        <div class="f-modal__body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {req.body}
          {req.input && <Field label={req.input.label}><Input inputRef={field} value={text} placeholder={req.input.placeholder} onInput={(e) => setText((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { e.preventDefault(); done(true); } }} /></Field>}
        </div>
      )}
      <div class="f-modal__foot">
        <span class="f-grow" />
        <Button kind="ghost" kbd="Esc" onClick={() => done(false)}>{req.cancelLabel ?? "Cancel"}</Button>
        {req.altLabel && <Button kind="archive" onClick={() => done("alt")}>{req.altLabel}</Button>}
        <Button btnRef={ok} kind={req.danger ? "danger-solid" : "primary"} disabled={!!req.input && !text.trim()} onClick={() => done(true)}>{req.confirmLabel}</Button>
      </div>
    </Modal>
  );
}
