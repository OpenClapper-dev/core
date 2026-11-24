import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { BORDER, makeStyles, RADIUS, type, useTheme } from "./theme";
import { Button } from "./actions";
import { Icon , type IconName } from "./core";
import { Sheet } from "./overlays";

/**
 * In-app confirm sheets and toasts (they replace Android alerts everywhere). Both are called as
 * plain functions from anywhere; ConfirmHost and ToastHost are mounted once in App.tsx.
 */
export interface ConfirmOptions {
  /** Phrased as a question: "Discard this shot?" */
  title: string;
  /** One sentence of consequence. */
  body?: string;
  confirmLabel: string;
  /** null = a notice with a single button. */
  cancelLabel?: string | null;
  /** Destructive: the confirm button is solid red. */
  danger?: boolean;
  icon?: IconName;
  /** A safer alternative next to the destructive action (e.g. Archive next to Delete). */
  altLabel?: string;
}

type Pending = ConfirmOptions & { resolve: (v: boolean | "alt") => void };
let showConfirm: ((p: Pending) => void) | null = null;

/** Resolves true (confirm), false (cancel, scrim, back) or "alt". */
export function confirm(o: ConfirmOptions): Promise<boolean | "alt"> {
  return new Promise((resolve) => {
    if (!showConfirm) { resolve(false); return; }
    showConfirm({ ...o, resolve });
  });
}

/** A notice with one button (errors the user has to read, e.g. a failed capture). */
export const notice = (title: string, body?: string) => confirm({ title, body, confirmLabel: "OK", cancelLabel: null }).then(() => undefined);

export function ConfirmHost() {
  const s = useStyles();
  const [p, setP] = useState<Pending | null>(null);
  useEffect(() => { showConfirm = setP; return () => { showConfirm = null; }; }, []);
  const done = (v: boolean | "alt") => { p?.resolve(v); setP(null); };
  const cancel = p?.cancelLabel === undefined ? "Cancel" : p.cancelLabel;
  return (
    <Sheet visible={!!p} title={p?.title ?? ""} onClose={() => done(false)} doneLabel={null}>
      {!!p?.body && <Text style={s.body}>{p.body}</Text>}
      {p && (
        <View style={{ gap: 8 }}>
          <View style={s.buttons}>
            {p.altLabel
              ? <Button style={{ flex: 1 }} kind="archive" label={p.altLabel} onPress={() => done("alt")} />
              : cancel !== null && <Button style={{ flex: 1 }} kind="secondary" label={cancel} onPress={() => done(false)} />}
            <Button style={{ flex: 1 }} kind={p.danger ? "dangerSolid" : "primary"} icon={p.icon ?? (p.danger ? "trash" : undefined)} label={p.confirmLabel} onPress={() => done(true)} />
          </View>
          {p.altLabel && cancel !== null && <Button kind="ghost" label={cancel} onPress={() => done(false)} />}
        </View>
      )}
    </Sheet>
  );
}

export type ToastKind = "ok" | "neutral" | "danger";
interface ToastMsg { id: number; text: string; kind: ToastKind; action?: { label: string; run: () => void }; ms: number }
let pushToast: ((t: ToastMsg) => void) | null = null;
let nextId = 1;

/** Opaque 52 dp toast above the bottom chrome; with an action (Undo) it stays 4 s, else 2.5 s. */
export function toast(text: string, kind: ToastKind = "ok", action?: { label: string; run: () => void }) {
  pushToast?.({ id: nextId++, text, kind, action, ms: action ? 4000 : 2500 });
}

/** Extra space a screen keeps free at the bottom (its pinned bar), so the toast sits above it. */
let offset = 0;
const offsetListeners = new Set<(n: number) => void>();
export function useToastOffset(n: number, active = true) {
  useEffect(() => {
    if (!active) return;
    offset = n; for (const cb of offsetListeners) cb(n);
    return () => { offset = 0; for (const cb of offsetListeners) cb(0); };
  }, [n, active]);
}

export function ToastHost({ bottom }: { bottom: number }) {
  const s = useStyles();
  const { c } = useTheme();
  const [t, setT] = useState<ToastMsg | null>(null);
  const [extra, setExtra] = useState(offset);
  useEffect(() => { pushToast = setT; offsetListeners.add(setExtra); return () => { pushToast = null; offsetListeners.delete(setExtra); }; }, []);
  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(() => setT((cur) => (cur?.id === t.id ? null : cur)), t.ms);
    return () => clearTimeout(timer);
  }, [t]);
  if (!t) return null;
  const icon = t.kind === "ok" ? "success" : t.kind === "danger" ? "error" : "info";
  const color = t.kind === "ok" ? c.ok : t.kind === "danger" ? c.danger : c.text;
  return (
    <View style={[s.toastWrap, { bottom: bottom + extra + 12 }]} pointerEvents="box-none">
      <View style={[s.toast, t.kind === "danger" && { borderColor: c.danger }]} accessibilityLiveRegion="polite">
        <Icon name={icon} size={22} color={color} />
        <Text style={s.toastText} numberOfLines={2}>{t.text}</Text>
        {t.action && (
          <Text onPress={() => { t.action?.run(); setT(null); }} style={s.toastAction} accessibilityRole="button" suppressHighlighting>{t.action.label}</Text>
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  body: { ...type("body"), color: c.text },
  buttons: { flexDirection: "row", gap: 8 },
  toastWrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  toast: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, maxWidth: 520, paddingLeft: 14, paddingRight: 6, paddingVertical: 6, borderRadius: RADIUS.md, backgroundColor: c.surfaceRaised, borderWidth: BORDER.control, borderColor: c.borderStrong, elevation: 8 },
  toastText: { ...type("small", "semibold"), color: c.text, flexShrink: 1, paddingRight: 8 },
  toastAction: { ...type("body", "heavy"), color: c.accent, minHeight: 44, lineHeight: 44, paddingHorizontal: 12 },
}));
