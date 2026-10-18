import * as SecureStore from "expo-secure-store";
import { scopedKey } from "./kv";

/**
 * The session (epic #107): an opaque token from signing in with email and password
 * (POST /api/auth/login, client "mobile"), kept in the device keystore with who it belongs to and
 * sent as `Authorization: Bearer`. It lasts 180 days and the server extends it while the app is
 * used, so only the server knows when it ends: a 401 clears it (api.ts).
 */
export interface Session {
  token: string;
  email: string;
  userId: string;
}

const KEY = scopedKey("fielder.session");
let cached: Session | null | undefined;
const listeners = new Set<() => void>();

function read(): Session | null {
  try {
    const raw = SecureStore.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    return s && typeof s.token === "string" && typeof s.userId === "string" ? s : null;
  } catch {
    return null;
  }
}

export function getSession(): Session | null {
  if (cached === undefined) {
    cached = read();
    // The Cloudflare Access token of earlier builds is worthless now; it would only linger in the keystore.
    void SecureStore.deleteItemAsync(scopedKey("fielder.accessToken")).catch(() => {});
  }
  return cached;
}

export function setSession(s: Session | null) {
  cached = s;
  try {
    if (s) SecureStore.setItem(KEY, JSON.stringify(s));
    else void SecureStore.deleteItemAsync(KEY);
  } catch (e) { console.warn("secure store", e); }
  for (const fn of listeners) fn();
}

export const getToken = () => getSession()?.token ?? null;
export const isSignedIn = () => !!getSession();
export const signedInEmail = () => getSession()?.email ?? null;
export const signedInUserId = () => getSession()?.userId ?? null;

export function onAuthChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
