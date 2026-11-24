import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Button, Confirm, ContextMenu, Dialog, FormField, TextInput, Toast, type MenuItemData } from "@openclapper/design";

/**
 * What any part of the Studio can ask of the shell without knowing where it is drawn: a toast, a
 * yes/no question, a one-line prompt, a menu at the pointer. The shell mounts `<Hosts />` once, above every window. No
 * browser dialogs anywhere (`window.confirm`, `alert`, `prompt`).
 */
type Tone = "info" | "success" | "warning" | "danger";
interface ToastItem { id: number; text: string; tone?: Tone; action?: { label: string; onClick: () => void } }
interface ConfirmAsk { kind: "confirm"; title: string; message?: string; confirmLabel?: string; danger?: boolean; done: (ok: boolean) => void }
interface PromptAsk { kind: "prompt"; title: string; label: string; value: string; confirmLabel: string; check?: (v: string) => string | null; done: (v: string | null) => void }

/** A menu entry with what it does; separators and headings as in the design system's menu. */
export type MenuEntry = (Extract<MenuItemData, { id: string }> & { run: () => void }) | Exclude<MenuItemData, { id: string }>;
interface OpenMenu { x: number; y: number; items: MenuEntry[] }

let menu: OpenMenu | null = null;
let toasts: ToastItem[] = [];
let ask: ConfirmAsk | PromptAsk | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const notify = () => { for (const cb of listeners) cb(); };

/** A short notice in the corner; with an action (Undo) it stays twice as long. */
export function toast(text: string, opts: { tone?: Tone; action?: { label: string; onClick: () => void } } = {}) {
  const item: ToastItem = { id: ++seq, text, ...opts };
  toasts = [...toasts.slice(-3), item];
  notify();
  setTimeout(() => dismiss(item.id), opts.action ? 8000 : 4000);
}
function dismiss(id: number) {
  if (!toasts.some((t) => t.id === id)) return;
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}
/** A failed request as a toast, with the server's own words. */
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : String(e), { tone: "danger" });

export function confirm(q: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((done) => { ask?.done(null as never); ask = { kind: "confirm", ...q, done }; notify(); });
}

/** One line of text, or null when it was cancelled. `check` returns what is wrong with a value, if anything. */
export function prompt(q: { title: string; label: string; value?: string; confirmLabel?: string; check?: (v: string) => string | null }): Promise<string | null> {
  return new Promise((done) => { ask?.done(null as never); ask = { kind: "prompt", value: "", confirmLabel: "Save", ...q, done }; notify(); });
}

/** Open a menu at the pointer (a right-click), or at a point (below a button). Entries that are false are left out. */
export function contextMenu(at: MouseEvent | { x: number; y: number }, items: (MenuEntry | false | null | undefined)[]) {
  if (at instanceof Event) at.preventDefault();
  const list = items.filter((i): i is MenuEntry => !!i);
  if (!list.length) return;
  menu = { x: "clientX" in at ? at.clientX : at.x, y: "clientY" in at ? at.clientY : at.y, items: list };
  notify();
}
export const closeMenu = () => { if (menu) { menu = null; notify(); } };

function MenuHost({ m }: { m: OpenMenu }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: m.x, y: m.y });
  // Kept inside the viewport: a menu opened near an edge opens the other way.
  useLayoutEffect(() => {
    const el = box.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, m.x + r.width > innerWidth - 4 ? m.x - r.width : m.x), y: Math.max(4, m.y + r.height > innerHeight - 4 ? m.y - r.height : m.y) });
  }, [m]);
  return (
    <div ref={box} className="st-menuhost" data-overlay>
      <ContextMenu x={pos.x} y={pos.y} items={m.items} onClose={closeMenu} onSelect={(id) => { const it = m.items.find((i) => "id" in i && i.id === id) as { run?: () => void } | undefined; closeMenu(); it?.run?.(); }} />
    </div>
  );
}

function PromptDialog({ q, close }: { q: PromptAsk; close: (v: string | null) => void }) {
  const [v, setV] = useState(q.value);
  const wrong = q.check ? q.check(v.trim()) : v.trim() ? null : "Type a name";
  const [tried, setTried] = useState(false);
  const submit = () => { if (wrong) setTried(true); else close(v.trim()); };
  // Focus by hand: the autofocus attribute does nothing on an element added after the page loaded.
  useEffect(() => { const el = document.getElementById("oc-prompt") as HTMLInputElement | null; el?.focus(); el?.select(); }, []);
  return (
    <Dialog fixed data-overlay title={q.title} onClose={() => close(null)} footer={<><Button onClick={() => close(null)}>Cancel</Button><Button variant="primary" onClick={submit}>{q.confirmLabel}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormField label={q.label} htmlFor="oc-prompt" error={tried ? wrong : undefined}>
          <TextInput id="oc-prompt" value={v} invalid={tried && !!wrong} style={{ width: "100%" }} onInput={(e) => setV(e.currentTarget.value)} />
        </FormField>
      </form>
    </Dialog>
  );
}

export function Hosts() {
  const [, tick] = useState(0);
  useEffect(() => { const cb = () => tick((n) => n + 1); listeners.add(cb); return () => { listeners.delete(cb); }; }, []);
  const q = ask;
  const answer = (v: boolean | string | null) => { ask = null; notify(); (q!.done as (x: unknown) => void)(v); };
  return (
    <>
      {q?.kind === "confirm" && <div data-overlay><Confirm fixed title={q.title} message={q.message} confirmLabel={q.confirmLabel} danger={q.danger} onConfirm={() => answer(true)} onCancel={() => answer(false)} /></div>}
      {q?.kind === "prompt" && <PromptDialog key={q.title + q.value} q={q} close={answer} />}
      {menu && <MenuHost key={`${menu.x},${menu.y}`} m={menu} />}
      <div className="oc-toast-stack st-toasts">
        {toasts.map((t) => <Toast key={t.id} tone={t.tone} action={t.action && { label: t.action.label, onClick: () => { t.action!.onClick(); dismiss(t.id); } }} onDismiss={() => dismiss(t.id)}>{t.text}</Toast>)}
      </div>
    </>
  );
}
