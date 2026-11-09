import { useEffect, useRef, useState } from "preact/hooks";
import type { LightCommand, ProvisionState, ProxyRequest, ProxyState, RunState, ScanState } from "@openclapper/vocab";

/**
 * The Studio's end of the light proxy (#307): the same per-user phone room as the layout preview
 * (worker/src/preview.ts). The phone running its Proxy screen reports its fixtures; commands go back
 * through the room. A slider drag is thinned here (one command per op every SEND_EVERY_MS, the last
 * value always sent) and again on the phone, which sends only what a light can take.
 */
const RETRY_MS = [1000, 3000, 10_000, 30_000];
const SEND_EVERY_MS = 60;

export interface LightProxy {
  /** The room's socket is open. */
  connected: boolean;
  /** Phones with the app in the foreground (whether or not their proxy is on). */
  phones: { id: string | null; model: string | null }[];
  /** The phone whose proxy is on, with its fixtures; null when none is. */
  proxy: ProxyState | null;
  send: (fixtureId: string, command: LightCommand) => void;
  /** The phone's latest scan (null: none since this tab opened). */
  scan: ScanState | null;
  /** Pairing progress per fixture, as the phone reports it. */
  provisioning: Record<string, ProvisionState>;
  request: (r: Exclude<ProxyRequest, { type: "lights.command" }>) => void;
  /** A sequence running on the phone (#321), as last reported, with when it arrived (performance.now). */
  run: (RunState & { receivedAt: number }) | null;
}

export function useLightProxy(): LightProxy {
  const [connected, setConnected] = useState(false);
  const [phones, setPhones] = useState<{ id: string | null; model: string | null }[]>([]);
  const [states, setStates] = useState<Record<string, ProxyState>>({});
  const [scan, setScan] = useState<ScanState | null>(null);
  const [provisioning, setProvisioning] = useState<Record<string, ProvisionState>>({});
  const [run, setRun] = useState<(RunState & { receivedAt: number }) | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const pending = useRef(new Map<string, { at: number; timer: ReturnType<typeof setTimeout> | null; msg: unknown }>());

  useEffect(() => {
    let closed = false, tries = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const w = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/preview/socket?role=studio`);
      ws.current = w;
      w.onopen = () => { tries = 0; setConnected(true); w.send(JSON.stringify({ type: "lights.hello" })); };
      w.onmessage = (e) => {
        try {
          const m = JSON.parse(String(e.data)) as { type?: string; phones?: { id: string | null; model: string | null }[] } & Partial<Omit<ProxyState, "type">>;
          if (m.type === "presence") {
            const list = Array.isArray(m.phones) ? m.phones : [];
            setPhones(list);
            // A phone that left takes its proxy with it.
            setStates((cur) => Object.fromEntries(Object.entries(cur).filter(([id]) => list.some((p) => p.id === id))));
          } else if (m.type === "lights.state" && m.phone && typeof m.phone.id === "string" && Array.isArray(m.fixtures)) {
            const s = m as ProxyState;
            setStates((cur) => ({ ...cur, [s.phone.id]: s }));
          } else if (m.type === "lights.scan.state" && Array.isArray((m as unknown as ScanState).found)) {
            setScan(m as unknown as ScanState);
          } else if (m.type === "lights.run.state") {
            setRun({ ...(m as unknown as RunState), receivedAt: performance.now() });
          } else if (m.type === "lights.provision.state") {
            const p = m as unknown as ProvisionState;
            if (typeof p.fixtureId === "string") setProvisioning((cur) => ({ ...cur, [p.fixtureId]: p }));
          }
        } catch { /* not ours */ }
      };
      w.onclose = () => {
        ws.current = null;
        setConnected(false);
        setPhones([]);
        setStates({});
        setRun(null);
        if (!closed) timer = setTimeout(connect, RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)]);
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); ws.current?.close(); for (const p of pending.current.values()) if (p.timer) clearTimeout(p.timer); };
  }, []);

  const send = (fixtureId: string, command: LightCommand) => {
    // Camera messages thin per parameter (#318): different parameters must all go out.
    const key = command.op === "ccu" ? `${fixtureId}:ccu:${command.message.category}.${command.message.parameter}` : `${fixtureId}:${command.op}`;
    const msg = { type: "lights.command", fixtureId, command };
    const out = () => {
      const p = pending.current.get(key);
      if (p) { p.at = Date.now(); p.timer = null; }
      if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(p?.msg ?? msg));
    };
    const p = pending.current.get(key);
    if (!p) { pending.current.set(key, { at: 0, timer: null, msg }); out(); return; }
    p.msg = msg;
    if (p.timer) return;
    const wait = p.at + SEND_EVERY_MS - Date.now();
    if (wait <= 0) out(); else p.timer = setTimeout(out, wait);
  };

  const request = (r: Exclude<ProxyRequest, { type: "lights.command" }>) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(r)); };
  const proxy = Object.values(states).find((s) => s.proxy) ?? null;
  // Without a proxy phone there is no run to show.
  return { connected, phones, proxy, send, scan, provisioning, request, run: proxy ? run : null };
}
