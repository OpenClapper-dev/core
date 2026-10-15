import { Directory, Paths } from "expo-file-system";
import Storage from "expo-sqlite/kv-store";
import { STORAGE_SCOPE } from "./config";

/**
 * The phone's key-value store, scoped to the server it talks to. One install keeps one store,
 * so a bundle pointed at the local Worker (`make mobile`) would otherwise see the
 * production upload queue and upload those captures to the wrong server. Production keeps the
 * bare keys; any other scope prefixes them.
 */
const key = (k: string) => (STORAGE_SCOPE ? `${STORAGE_SCOPE}/${k}` : k);

export const kv = {
  getItemSync: (k: string) => Storage.getItemSync(key(k)),
  setItemSync: (k: string, v: string) => Storage.setItemSync(key(k), v),
  removeItemSync: (k: string) => Storage.removeItemSync(key(k)),
};

/** A folder under the app's documents, in the same scope as `kv`. */
export const dataDir = (name: string) => (STORAGE_SCOPE ? new Directory(Paths.document, STORAGE_SCOPE, name) : new Directory(Paths.document, name));

/** The same scoping for a secure-store key (the session token). */
export const scopedKey = (k: string) => (STORAGE_SCOPE ? `${k}.${STORAGE_SCOPE}` : k);
