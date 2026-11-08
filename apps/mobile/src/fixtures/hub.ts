import { AppState } from "react-native";
import { connect } from "../ble/link";
import { log } from "../log";
import { Hub, type FixtureStatus } from "./hubCore";
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

/** The app's one hub (fixtures/hubCore.ts) on the real Bluetooth stack and clock. */
export const hub = new Hub({
  fixtures: getFixtures,
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
    case "connecting": return "Connecting…";
    case "retrying": return `Reconnecting (try ${s.attempt + 1})${s.error ? ` · ${s.error}` : ""}`;
    case "failed": return s.error ?? "Cannot connect";
    default: return "Not connected";
  }
}
