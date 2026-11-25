// The Hardware extension's side of the phone link in the Studio (docs/features/hardware.md): the proxy phone's
// reports on the `hardware` channel, and requests to it. Slider drags are thinned to one command per device and op
// every THIN_MS (the last value always goes); the phone's queue coalesces again.
import { useEffect, useState } from "preact/hooks";
import { HARDWARE_CHANNEL, type HardwareProvision, type HardwareRequest, type HardwareScan, type HardwareState, type LightCommand } from "@openclapper/ext-hardware";
import { sendLink, usePhoneLink } from "../../phoneLink";

const THIN_MS = 60;

let state: HardwareState | null = null;
let scan: HardwareScan | null = null;
let provision: HardwareProvision | null = null;
const listeners = new Set<() => void>();
const changed = () => { for (const cb of listeners) cb(); };

function onMessage(m: Record<string, unknown>) {
  if (m.ch !== HARDWARE_CHANNEL) return;
  if (m.type === "state") {
    const s = m as unknown as HardwareState;
    // Several phones may report; the one with the proxy on wins, and its "off" clears it.
    if (s.proxy || !state || state.phone.id === s.phone.id) { state = s; changed(); }
  } else if (m.type === "scan.state") { scan = m as unknown as HardwareScan; changed(); }
  else if (m.type === "provision.state") { provision = m as unknown as HardwareProvision; changed(); }
}

export const request = (r: HardwareRequest) => sendLink({ ch: HARDWARE_CHANNEL, ...r });

/** Devices a flow drives while it plays from this Studio (the Flows extension sets them): their controls here are locked meanwhile. */
let busy: ReadonlySet<string> = new Set();
export function setBusyDevices(ids: readonly string[]) { busy = new Set(ids); changed(); }
export const isBusy = (id: string) => busy.has(id);

const pending = new Map<string, { cmd: LightCommand; timer: ReturnType<typeof setTimeout> | null; last: number }>();
/** A command to a device through the proxy, thinned per device and op. */
export function command(device: string, cmd: LightCommand) {
  const key = `${device}|${cmd.op}|${cmd.op === "ccu" ? `${cmd.message.category}.${cmd.message.parameter}` : ""}`;
  const p = pending.get(key) ?? { cmd, timer: null, last: 0 };
  p.cmd = cmd;
  pending.set(key, p);
  if (p.timer) return;
  const wait = Math.max(0, p.last + THIN_MS - Date.now());
  p.timer = setTimeout(() => { p.timer = null; p.last = Date.now(); request({ type: "command", device, command: p.cmd }); }, wait);
}

/** The live state for a component; asks the proxy for its state when the link opens. */
export function useHardware() {
  const link = usePhoneLink(onMessage);
  const [, tick] = useState(0);
  useEffect(() => { const cb = () => tick((n) => n + 1); listeners.add(cb); return () => { listeners.delete(cb); }; }, []);
  useEffect(() => { if (link.open) request({ type: "hello" }); else if (state) { state = null; changed(); } }, [link.open]);
  return { link, state: state?.proxy ? state : null, scan, provision };
}
export type HardwareCtx = ReturnType<typeof useHardware>;
