import { useEffect, useState } from "preact/hooks";
import { fetchServerBuild } from "./api";

/**
 * Which instance this Studio talks to: "" for production, the server's INSTANCE_LABEL otherwise
 * ("staging"). Asked once per page load from /api/ping (public, so the sign-in page knows it too);
 * it puts the label in front of the tab title and feeds the marker in the taskbar and on sign-in, so
 * a staging tab is never taken for production. Unreachable: no label, the Studio shows its own errors.
 */
let label = "";
const listeners = new Set<(l: string) => void>();

fetchServerBuild().then(
  (b) => {
    label = b.instance ?? "";
    if (label) document.title = `${label[0].toUpperCase()}${label.slice(1)} · ${document.title}`;
    for (const cb of listeners) cb(label);
  },
  () => {},
);

export function useInstance(): string {
  const [l, setL] = useState(label);
  useEffect(() => { listeners.add(setL); setL(label); return () => { listeners.delete(setL); }; }, []);
  return l;
}

/** The design system's environment marker for this page: the dev server, a labelled instance, or production. */
export const envOf = (instance: string): "production" | "staging" | "development" => (import.meta.env.DEV ? "development" : instance ? "staging" : "production");
