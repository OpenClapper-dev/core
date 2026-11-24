// The phone link as the Studio holds it (docs/features/camera-layouts.md, "The phone link"): one socket for the
// whole page, opened while an app uses it and kept open while any does, again after a drop. It knows which of the
// person's phones are connected and whether a layout is being previewed; apps send on their channel.
import { useEffect, useState } from "preact/hooks";

export interface LinkPhone { id: string | null; name: string }
interface LinkState { open: boolean; phones: LinkPhone[]; previewing: boolean }

let ws: WebSocket | null = null;
let users = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
let state: LinkState = { open: false, phones: [], previewing: false };
const listeners = new Set<() => void>();
const handlers = new Set<(m: Record<string, unknown>) => void>();
const notify = () => { for (const cb of listeners) cb(); };

function connect() {
  clearTimeout(retry);
  const s = new WebSocket(`${location.origin.replace(/^http/, "ws")}/api/link?role=studio`);
  ws = s;
  s.onopen = () => { state = { ...state, open: true }; notify(); };
  s.onmessage = (e) => {
    let m: Record<string, unknown>;
    try { m = JSON.parse(String(e.data)) as Record<string, unknown>; } catch { return; }
    if (m.ch === "link" && m.type === "presence") { state = { ...state, phones: (m.phones as LinkPhone[]) ?? [], previewing: !!m.previewing }; notify(); }
    if (m.ch === "layout" && m.type === "exit") { state = { ...state, previewing: false }; notify(); }
    for (const h of handlers) h(m);
  };
  s.onclose = () => {
    if (ws === s) ws = null;
    state = { open: false, phones: [], previewing: false }; notify();
    if (users > 0) retry = setTimeout(connect, 3000);
  };
}

/** Sends a message on a channel; nothing when the link is down. */
export function sendLink(msg: { ch: string; type: string } & Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** The link's state for a component; the link is open while one uses it. `onMessage` hears everything that arrives. */
export function usePhoneLink(onMessage?: (m: Record<string, unknown>) => void): LinkState {
  const [, tick] = useState(0);
  useEffect(() => {
    const cb = () => tick((n) => n + 1);
    listeners.add(cb);
    if (onMessage) handlers.add(onMessage);
    if (users++ === 0 && !ws) connect();
    return () => {
      listeners.delete(cb);
      if (onMessage) handlers.delete(onMessage);
      if (--users === 0) { clearTimeout(retry); ws?.close(); ws = null; }
    };
  }, []);
  return state;
}
