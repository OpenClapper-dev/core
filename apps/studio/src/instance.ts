import { useEffect, useState } from "preact/hooks";
import { instanceTitle } from "@openclapper/ui";
import { fetchServerBuild } from "./api";

/**
 * Which instance this Studio talks to: "" for production, the server's INSTANCE_LABEL otherwise
 * ("staging"). Asked once per page load from /api/ping (public, so the sign-in page knows it too);
 * it puts the label in front of the tab title and feeds the badge in the taskbar and on sign-in, so
 * a staging tab is never taken for production. Unreachable: no label, the Studio shows its own errors.
 */
let label = "";
const listeners = new Set<(l: string) => void>();

fetchServerBuild().then(
  (b) => {
    label = b.instance ?? "";
    document.title = instanceTitle(document.title, label);
    for (const cb of listeners) cb(label);
  },
  () => {},
);

export function useInstance(): string {
  const [l, setL] = useState(label);
  useEffect(() => { listeners.add(setL); setL(label); return () => { listeners.delete(setL); }; }, []);
  return l;
}
