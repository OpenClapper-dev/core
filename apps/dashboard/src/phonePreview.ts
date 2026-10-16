import { useEffect, useRef, useState } from "preact/hooks";
import { validateDeviceSpecs, type DeviceSpecs, type ViewfinderLayout, type VfOrientationName } from "@fielder/vocab";

/**
 * The dashboard's end of the live layout preview (issue #50, worker/src/preview.ts). Connected while
 * the layout editor is open; the phone is connected whenever the app is in the foreground. Leaving the
 * editor closes the socket, which ends the preview on the phone. Issue #68: the room says which
 * phones are there (id, model), and a phone's specs arrive on connect, on change and on `readout()`.
 */
export interface ConnectedPhone { id: string | null; model: string | null }
export interface PhonePreview {
  /** Phones connected right now (none = the app is closed or in the background). */
  phones: ConnectedPhone[];
  previewing: boolean;
  connected: boolean;
  /** The latest specs per phone id, as the phones sent them while this editor was open. */
  specs: Record<string, DeviceSpecs>;
  show: (layout: ViewfinderLayout, orientation: VfOrientationName) => void;
  stop: () => void;
  /** Ask the phones to send their specs now. */
  readout: () => void;
}

const RETRY_MS = [1000, 3000, 10_000, 30_000];

export function usePhonePreview(): PhonePreview {
  const [state, setState] = useState<{ phones: ConnectedPhone[]; previewing: boolean; connected: boolean }>({ phones: [], previewing: false, connected: false });
  const [specs, setSpecs] = useState<Record<string, DeviceSpecs>>({});
  const ws = useRef<WebSocket | null>(null);
  useEffect(() => {
    let closed = false, tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const w = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/preview/socket?role=dashboard`);
      ws.current = w;
      w.onopen = () => { tries = 0; setState((s) => ({ ...s, connected: true })); };
      w.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data)) as { type?: string; phones?: ConnectedPhone[]; previewing?: boolean; id?: string; specs?: unknown };
          if (m.type === "presence") setState({ phones: Array.isArray(m.phones) ? m.phones : [], previewing: !!m.previewing, connected: true });
          else if (m.type === "specs" && typeof m.id === "string" && !validateDeviceSpecs(m.specs)) { const id = m.id; setSpecs((cur) => ({ ...cur, [id]: m.specs as DeviceSpecs })); }
        } catch { /* not ours */ }
      };
      w.onclose = () => {
        ws.current = null;
        setState({ phones: [], previewing: false, connected: false });
        if (!closed) timer = setTimeout(connect, RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)]);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws.current?.close(); };
  }, []);
  const send = (msg: unknown) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg)); };
  return {
    ...state,
    specs,
    show: (layout, orientation) => send({ type: "preview", layout, orientation }),
    stop: () => send({ type: "stop" }),
    readout: () => send({ type: "readout" }),
  };
}
