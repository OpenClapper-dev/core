import { AppState } from "react-native";
import { connect, scan } from "../ble/link";
import { log } from "../log";
import { Hub, type FixtureStatus, type Presence } from "./hubCore";
import { getFixtures } from "./library";
import { driverFor, setDriverLog, setMeshAccess } from "./registry";
import { getMeshNetworks, networkKeys, saveMeshNetwork, seqFor } from "./meshNetworks";

setDriverLog(log);
setMeshAccess({
  keysFor(networkId) {
    const n = getMeshNetworks().find((x) => x.id === networkId);
    const keys = n && networkKeys(n);
    if (!n || !keys) return null;
    return { keys, seq: seqFor(networkId), onIvIndex: (iv) => { const cur = getMeshNetworks().find((x) => x.id === networkId); if (cur) void saveMeshNetwork({ ...cur, ivIndex: iv }); } };
  },
});

/** A device counts as near while it advertised within this long. */
const NEAR_MS = 15_000;
const lastSeen = new Map<string, number>();
const seenListeners = new Set<(address: string) => void>();
let stopScan: (() => void) | null = null;

/**
 * Who advertises nearby (#318): a scan shared with pairing (ble/link.ts), running only while the hub
 * misses a held link. A device seen again after a gap is announced, so the hub tries it.
 */
const presence: Presence = {
  near: (addresses) => addresses.some((a) => Date.now() - (lastSeen.get(a.toUpperCase()) ?? Number.NEGATIVE_INFINITY) < NEAR_MS),
  watch(on) {
    if (on && !stopScan) {
      log("info", "presence scan on");
      stopScan = scan(
        (d) => {
          const a = d.address.toUpperCase();
          const fresh = Date.now() - (lastSeen.get(a) ?? Number.NEGATIVE_INFINITY) >= NEAR_MS;
          lastSeen.set(a, Date.now());
          if (fresh) for (const cb of seenListeners) cb(a);
        },
        (e) => log("warn", "presence scan failed", { error: e }),
      );
    } else if (!on && stopScan) {
      log("info", "presence scan off");
      stopScan();
      stopScan = null;
    }
  },
  onSeen(cb) { seenListeners.add(cb); return () => { seenListeners.delete(cb); }; },
  forget() { lastSeen.clear(); },
};

/** The app's one hub (fixtures/hubCore.ts) on the real Bluetooth stack and clock. */
export const hub = new Hub({
  fixtures: getFixtures,
  presence,
  driverFor,
  connect,
  timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
  clock: { now: () => Date.now(), wait: (ms) => new Promise((r) => setTimeout(r, ms)) },
  log,
});

let watching = false;
/** Android stops Bluetooth work in the background: close there, reopen on return. Started on first use. */
export function watchAppState() {
  if (watching) return;
  watching = true;
  AppState.addEventListener("change", (s) => {
    if (s === "active") hub.resume();
    else if (s === "background") hub.suspend();
  });
}

export function linkLabel(s: FixtureStatus): string {
  switch (s.link) {
    case "ready": return "Connected";
    case "silent": return "In the mesh, not answering (off?)";
    case "waiting": return "Waiting to connect";
    case "absent": return "Not in range";
    case "connecting": return "Connecting…";
    case "retrying": return `Reconnecting (try ${s.attempt + 1})${s.error ? ` · ${s.error}` : ""}`;
    case "failed": return s.error ?? "Cannot connect";
    default: return "Not connected";
  }
}
