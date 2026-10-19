/** Feedback from the design system (feedback.css): banners, empty and loading states, spinners, errors, save status, toasts. */
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { cx, Icon } from "./core";

/** Centred empty/loading/error message for a whole panel. */
export function Empty({ icon = "image-off-outline", title, children, actions, tone }: { icon?: string; title: string; children?: ComponentChildren; actions?: ComponentChildren; tone?: "ok" }) {
  return (
    <div class="f-empty" style={{ flex: 1, justifyContent: "center" }}>
      <div class="f-empty__icon" style={tone === "ok" ? { borderColor: "var(--ok)", color: "var(--ok)" } : undefined}><Icon name={icon} /></div>
      <div class="f-empty__title">{title}</div>
      {children && <div class="f-empty__body">{children}</div>}
      {actions && <div class="f-empty__actions">{actions}</div>}
    </div>
  );
}

export function Loading({ children = "Loading…" }: { children?: ComponentChildren }) {
  return <div class="status"><span class="f-loading"><span class="f-spinner" />{children}</span></div>;
}

/** Inline error line: red, with an icon, never colour alone. */
export function ErrorLine({ children }: { children: ComponentChildren }) {
  return <div class="f-field__error" role="alert"><Icon name="alert-circle" />{children}</div>;
}

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

/** Inline save status: Saving… / Saved / Not saved (+ Retry) / Unsaved changes. */
export function SaveStatus({ state, onRetry, savedLabel = "Saved" }: { state: SaveState; onRetry?: () => void; savedLabel?: string }) {
  if (state === "idle") return null;
  return (
    <span class={cx("f-save", state === "saving" && "f-save--saving", state === "saved" && "f-save--saved", state === "error" && "f-save--error", state === "dirty" && "f-save--dirty")} role="status">
      {state === "saving" ? <span class="f-spinner" /> : <Icon name={state === "saved" ? "check" : state === "error" ? "alert-circle" : "circle-edit-outline"} />}
      {state === "saving" ? "Saving…" : state === "saved" ? savedLabel : state === "error" ? "Not saved" : "Unsaved changes"}
      {state === "error" && onRetry && <button type="button" class="f-linkbtn" style={{ fontSize: "var(--text-caption)" }} onClick={onRetry}>Retry</button>}
    </span>
  );
}


interface ToastReq { id: number; text: string; kind: "ok" | "danger" | "info"; action?: { label: string; run: () => void } }
let pushToast: ((t: ToastReq) => void) | null = null;
let toastId = 0;

/** A short opaque message bottom-centre; an optional action (e.g. Undo) keeps it 6 s. */
export function toast(text: string, kind: ToastReq["kind"] = "ok", action?: ToastReq["action"]) {
  pushToast?.({ id: ++toastId, text, kind, action });
}

export function ToastHost() {
  const [items, setItems] = useState<ToastReq[]>([]);
  useEffect(() => {
    pushToast = (t) => {
      setItems((cur) => [...cur.slice(-2), t]);
      setTimeout(() => setItems((cur) => cur.filter((x) => x.id !== t.id)), t.action ? 6000 : 2500);
    };
    return () => { pushToast = null; };
  }, []);
  if (items.length === 0) return null;
  return (
    <div class="toasts" role="status">
      {items.map((t) => (
        <div key={t.id} class={cx("f-toast", t.kind === "danger" && "f-toast--danger", t.kind === "ok" && "f-toast--ok")}>
          <Icon name={t.kind === "danger" ? "alert-circle" : t.kind === "ok" ? "check-circle" : "information-outline"} />
          <span class="f-toast__text">{t.text}</span>
          {t.action && <button type="button" class="f-btn f-btn--secondary f-btn--sm" onClick={() => { t.action!.run(); setItems((cur) => cur.filter((x) => x.id !== t.id)); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

/**
 * Banner (f-banner): icon, a bold title, a meta line, then an optional action (Retry).
 * Pass `role="alert"` when it reports something that just went wrong.
 */
export function Banner({ kind = "danger", icon = "alert-circle", title, meta, metaClass, action, role }: {
  kind?: "danger" | "warn" | "ok" | "info"; icon?: string; title: ComponentChildren; meta?: ComponentChildren; metaClass?: string; action?: ComponentChildren; role?: "alert" | "status";
}) {
  return (
    <div class={`f-banner f-banner--${kind}`} role={role}>
      <Icon name={icon} />
      <div class="f-banner__text"><span class="f-banner__title">{title}</span>{meta !== undefined && <span class={cx("f-banner__meta", metaClass)}>{meta}</span>}</div>
      {action}
    </div>
  );
}

/** The indeterminate spinner (f-spinner); `style` for the small inline variant inside a button. */
export const Spinner = ({ style }: { style?: JSX.CSSProperties }) => <span class="f-spinner" style={style} />;

/** Determinate progress bar (f-progress); `value` is 0..1. */
export function ProgressBar({ value, height }: { value: number; height?: string }) {
  return <div class="f-progress" style={height ? { height } : undefined}><div class="f-progress__bar" style={{ width: `${value * 100}%` }} /></div>;
}

/** Small empty message inside a list or panel (Empty is for a whole page): optional title, one meta line; `dashed` frames it. */
export function EmptyNote({ title, dashed, children }: { title?: ComponentChildren; dashed?: boolean; children: ComponentChildren }) {
  return (
    <div class={cx("f-empty", dashed && "dashed")}>
      {title && <div class="f-empty__title" style={{ fontSize: "var(--text-body-lg)" }}>{title}</div>}
      <div class="meta">{children}</div>
    </div>
  );
}
