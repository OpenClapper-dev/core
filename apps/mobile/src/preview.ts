import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { validateViewfinderLayout, type ViewfinderLayout } from "@fielder/vocab";
import { getToken, isSignedIn, onAuthChange } from "./auth";
import { API_URL } from "./config";
import { log } from "./log";

/**
 * The phone's end of the live layout preview (issue #50, worker/src/preview.ts). While the app is in
 * the foreground and signed in, a websocket stays open so the dashboard sees "phone connected"; when
 * the layout editor starts a preview, the Shoot screen shows that layout, in the orientation the
 * dashboard picked, with inert buttons. The preview never touches stored settings or data.
 */
export interface LivePreview { layout: ViewfinderLayout; orientation: "portrait" | "landscape" }

const RETRY_MS = [2000, 5000, 15_000, 30_000];
const NativeWebSocket = WebSocket as unknown as new (url: string, protocols: null, options: { headers: Record<string, string> }) => WebSocket;

/** `enabled` is off in offline mode: no socket then either. */
export function useLivePreview(enabled: boolean): { preview: LivePreview | null; exit: () => void } {
  const [preview, setPreview] = useState<LivePreview | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const [active, setActive] = useState(AppState.currentState === "active");
  const [signedIn, setSignedIn] = useState(isSignedIn);
  useEffect(() => { const sub = AppState.addEventListener("change", (s) => setActive(s === "active")); return () => sub.remove(); }, []);
  useEffect(() => onAuthChange(() => setSignedIn(isSignedIn())), []);

  useEffect(() => {
    if (!enabled || !active || !signedIn || !API_URL) return;
    let closed = false, tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const token = getToken();
      // React Native's WebSocket takes headers (a third argument the DOM typings don't know): the Access token, as on every API call.
      const w = new NativeWebSocket(`${API_URL.replace(/^http/, "ws")}/api/preview/socket?role=phone`, null, { headers: token ? { "cf-access-token": token } : {} });
      ws.current = w;
      w.onopen = () => { tries = 0; };
      w.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data)) as { type?: string; layout?: unknown; orientation?: unknown };
          if (m.type === "preview" && !validateViewfinderLayout(m.layout) && (m.orientation === "portrait" || m.orientation === "landscape")) {
            setPreview({ layout: m.layout as ViewfinderLayout, orientation: m.orientation });
          } else if (m.type === "stop") setPreview(null);
        } catch { /* not ours */ }
      };
      w.onclose = (e) => {
        ws.current = null;
        if (closed) return;
        log("info", "preview link closed", { code: e.code });
        timer = setTimeout(connect, RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)]);
      };
    };
    connect();
    // Backgrounded or signed out: close; the preview ends with it (the dashboard sees the phone leave).
    return () => { closed = true; clearTimeout(timer); ws.current?.close(); ws.current = null; setPreview(null); };
  }, [enabled, active, signedIn]);

  const exit = () => {
    setPreview(null);
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify({ type: "exit" }));
  };
  return { preview, exit };
}
