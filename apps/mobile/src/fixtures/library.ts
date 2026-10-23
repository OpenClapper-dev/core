import { useEffect, useState } from "react";
import { api } from "../api";
import { log } from "../log";
import { store } from "../storage";
import type { Fixture } from "./types";

/**
 * The paired fixtures (#208), shared by Setup → Lights and the hub. Like the rigs: kept on the
 * phone so they work offline, pushed to the Worker, and the server list wins after a sync, so
 * another phone of the same workspace sees them too (its mesh keys stay on the phone that made them).
 */
let fixtures: Fixture[] = store.loadFixtures();
const listeners = new Set<() => void>();

function commit(next: Fixture[]) {
  fixtures = next;
  store.saveFixtures(fixtures);
  for (const cb of listeners) cb();
}

export const getFixtures = () => fixtures;

export function useFixtures(): Fixture[] {
  const [v, setV] = useState(getFixtures);
  useEffect(() => { const cb = () => setV(getFixtures()); listeners.add(cb); cb(); return () => { listeners.delete(cb); }; }, []);
  return v;
}

/** Save locally first (usable at once, also offline), then push; an unsynced fixture is pushed again by the next sync. */
export async function saveFixture(f: Fixture) {
  const mine = { ...f, synced: false };
  commit(fixtures.some((x) => x.id === f.id) ? fixtures.map((x) => (x.id === f.id ? mine : x)) : [...fixtures, mine]);
  try {
    await api.putFixture(mine);
    commit(fixtures.map((x) => (x.id === f.id ? { ...x, synced: true } : x)));
  } catch (err) {
    log("warn", "fixture sync failed; retried on the next sync", { fixture: f.id, error: err });
  }
}

export async function deleteFixture(id: string) {
  commit(fixtures.filter((x) => x.id !== id));
  try { await api.deleteFixture(id); } catch (err) { log("warn", "fixture delete failed", { fixture: id, error: err }); }
}

let syncing: Promise<void> | null = null;

/** Push offline edits, then take the server list. Quiet when unreachable. */
export function syncFixtures(): Promise<void> {
  syncing ??= (async () => {
    try {
      // One refused fixture must not block the others; it stays unsynced and is logged.
      for (const f of fixtures.filter((x) => !x.synced)) {
        try { await api.putFixture(f); } catch (err) { log("warn", "fixture push refused", { fixture: f.id, error: err }); }
      }
      const server = await api.listFixtures();
      // A fixture saved while the list was on its way stays.
      const unsent = fixtures.filter((x) => !x.synced && !server.some((s) => s.id === x.id));
      commit([...server, ...unsent]);
    } catch (err) {
      log("info", "fixture sync skipped", { error: err });
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}
