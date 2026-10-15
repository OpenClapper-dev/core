import { useEffect, useRef, useState } from "preact/hooks";
import type { ViewfinderLayout, VfOrientationName } from "@fielder/vocab";

/**
 * The dashboard's end of the live layout preview (issue #50, worker/src/preview.ts). Connected while
 * the layout editor is open; the phone is connected whenever the app is in the foreground. Leaving the
 * editor closes the socket, which ends the preview on the phone.
 */
export interface PhonePreview {
  /** Phones connected right now (0 = the app is closed or in the background). */
  phones: number;
  previewing: boolean;
  connected: boolean;
  show: (layout: ViewfinderLayout, orientation: VfOrientationName) => void;
  stop: () => void;
}

const RETRY_MS = [1000, 3000, 10_000, 30_000];

export function usePhonePreview(): PhonePreview {
  const [state, setState] = useState({ phones: 0, previewing: false, connected: false });
  const ws = useRef<WebSocket | null>(null);
  useEffect(() => {
    let closed = false, tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const w = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/preview/socket?role=dashboard`);
      ws.current = w;
      w.onopen = () => { tries = 0; setState((s) => ({ ...s, connected: true })); };
      w.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data)) as { type?: string; phones?: number; previewing?: boolean };
          if (m.type === "presence") setState({ phones: m.phones ?? 0, previewing: !!m.previewing, connected: true });
        } catch { /* not ours */ }
      };
      w.onclose = () => {
        ws.current = null;
        setState({ phones: 0, previewing: false, connected: false });
        if (!closed) timer = setTimeout(connect, RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)]);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws.current?.close(); };
  }, []);
  const send = (msg: unknown) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg)); };
  return {
    ...state,
    show: (layout, orientation) => send({ type: "preview", layout, orientation }),
    stop: () => send({ type: "stop" }),
  };
}
