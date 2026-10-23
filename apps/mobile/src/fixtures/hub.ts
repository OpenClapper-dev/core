import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { connect } from "../ble/link";
import { log } from "../log";
import { Hub, type FixtureStatus, type Holder } from "./hubCore";
import { getFixtures } from "./library";
import { driverFor } from "./registry";
import type { Command } from "./types";

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
function watchAppState() {
  if (watching) return;
  watching = true;
  AppState.addEventListener("change", (s) => {
    if (s === "active") hub.resume();
    else if (s === "background") hub.suspend();
  });
}

/** Keep the fixtures connected while the calling screen is shown. */
export function useFixtureLease(ids: string[], holder: Holder = "screen") {
  const key = ids.join(",");
  useEffect(() => {
    watchAppState();
    return hub.acquire(key ? key.split(",") : [], holder);
  }, [key, holder]);
}

export function useFixtureStatus(id: string): FixtureStatus {
  const [s, setS] = useState(() => hub.status(id));
  useEffect(() => {
    const cb = () => setS(hub.status(id));
    cb();
    return hub.subscribe(cb);
  }, [id]);
  return s;
}

/** Queued and coalesced; rejects when the fixture is not connected. */
export const sendToFixture = (id: string, cmd: Command) => hub.send(id, cmd);

export function linkLabel(s: FixtureStatus): string {
  switch (s.link) {
    case "ready": return "Connected";
    case "connecting": return "Connecting…";
    case "retrying": return `Reconnecting (try ${s.attempt + 1})${s.error ? ` · ${s.error}` : ""}`;
    case "failed": return s.error ?? "Cannot connect";
    default: return "Not connected";
  }
}
