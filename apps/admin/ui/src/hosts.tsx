/** What any part of the board can ask without knowing where it is drawn: a toast, a yes/no question. No browser dialogs. */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Confirm, Toast } from "@openclapper/design";

type Tone = "info" | "success" | "warning" | "danger";
interface ToastItem { id: number; text: string; tone?: Tone }
interface Ask { title: string; message?: ComponentChildren; confirmLabel?: string; danger?: boolean; only?: boolean; done: (ok: boolean) => void }
let toasts: ToastItem[] = [];
let ask: Ask | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const notify = () => { for (const cb of listeners) cb(); };

export function toast(text: string, tone?: Tone) {
  const item: ToastItem = { id: ++seq, text, tone };
  toasts = [...toasts.slice(-3), item];
  notify();
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== item.id); notify(); }, 4000);
}
/** A yes/no question; `only`: a notice with one button (a password shown once). */
export function confirm(q: Omit<Ask, "done">): Promise<boolean> {
  return new Promise((done) => { ask?.done(false); ask = { ...q, done }; notify(); });
}

export function Hosts() {
  const [, tick] = useState(0);
  useEffect(() => { const cb = () => tick((n) => n + 1); listeners.add(cb); return () => { listeners.delete(cb); }; }, []);
  const answer = (ok: boolean) => { const a = ask; ask = null; notify(); a?.done(ok); };
  return (
    <>
      {ask && <Confirm fixed title={ask.title} message={ask.message} confirmLabel={ask.confirmLabel} danger={ask.danger} cancelLabel={ask.only ? "Close" : "Cancel"} onConfirm={() => answer(true)} onCancel={() => answer(false)} />}
      <div className="oc-toast-stack adm-toasts">{toasts.map((t) => <Toast key={t.id} tone={t.tone}>{t.text}</Toast>)}</div>
    </>
  );
}
