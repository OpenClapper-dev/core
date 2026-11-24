import { AppState } from "react-native";
import { authHeaders, canCall } from "./api";
import { API_URL } from "./config";
import { device, syncDevice } from "./device";
import { log } from "./log";
import { persisted } from "./store";
import { onSync } from "./sync";

/**
 * The phone's end of the phone link (docs/features/camera-layouts.md): one socket to the person's Studio tabs
 * while the app is in front and signed in, again after a drop (2, 5, 15, 30 s). It says hello with the device,
 * shows a camera layout the Studio previews (channel `layout`), and registers again when the Studio asks
 * (`readout`). Extensions add their channels with `onChannel` and `sendLink`.
 */
type Msg = { ch: string; type: string } & Record<string, unknown>;
let ws: WebSocket | null = null;
let tries = 0;
let retry: ReturnType<typeof setTimeout> | undefined;
const channels = new Map<string, Set<(m: Msg) => void>>();

/** A camera layout the Studio shows on this phone while it is changed there; nothing is saved. */
export const previewLayout = persisted<{ layout: unknown; orientation: "portrait" | "landscape" } | null>("linkPreview.v1", null);

export function sendLink(msg: Msg) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)); }
/** Hears the messages of one channel; returns the way to stop. */
export function onChannel(ch: string, fn: (m: Msg) => void): () => void {
  if (!channels.has(ch)) channels.set(ch, new Set());
  channels.get(ch)!.add(fn);
  return () => { channels.get(ch)?.delete(fn); };
}
/** Leaves the Studio's preview here (the chip on the camera). */
export function leavePreview() { previewLayout.set(null); sendLink({ ch: "layout", type: "exit" }); }

function hello() {
  const f = device.get().file;
  if (f) sendLink({ ch: "link", type: "hello", device: { id: f.id, name: f.name } });
}

function open() {
  clearTimeout(retry);
  if (ws || !canCall() || AppState.currentState !== "active") return;
  // React Native's WebSocket takes headers: the session goes as it does for every call.
  const s = new (WebSocket as unknown as new (url: string, protocols: string[] | null, opts: { headers: Record<string, string> }) => WebSocket)(`${API_URL.replace(/^http/, "ws")}/api/link?role=phone`, null, { headers: authHeaders() });
  ws = s;
  s.onopen = () => { tries = 0; hello(); };
  s.onmessage = (e) => {
    let m: Msg;
    try { m = JSON.parse(String(e.data)) as Msg; } catch { return; }
    if (m.ch === "layout" && m.type === "preview") previewLayout.set({ layout: m.layout, orientation: m.orientation === "landscape" ? "landscape" : "portrait" });
    else if (m.ch === "layout" && m.type === "stop") previewLayout.set(null);
    else if (m.ch === "link" && m.type === "readout") void syncDevice().then(hello);
    for (const fn of channels.get(m.ch) ?? []) fn(m);
  };
  s.onclose = () => {
    if (ws === s) ws = null;
    // A preview never outlives the link: the phone's own layout comes back.
    previewLayout.set(null);
    if (AppState.currentState === "active" && canCall()) retry = setTimeout(open, [2000, 5000, 15000, 30000][Math.min(tries++, 3)]);
  };
  s.onerror = () => log("warn", "phone link error");
}

function close() { clearTimeout(retry); ws?.close(); ws = null; }

/** Keeps the link open while the app is in front; called once at start. */
export function startLink() {
  previewLayout.set(null);
  open();
  // Signed in, or back online: the sync runs, and the link opens with it.
  onSync(async () => open());
  AppState.addEventListener("change", (st) => { if (st === "active") open(); else close(); });
  // A device that registers after the link opened says hello now.
  let said = "";
  device.subscribe(() => { const f = device.get().file, now = f ? `${f.id}|${f.name}` : ""; if (now !== said) { said = now; hello(); } });
}
