import * as SecureStore from "expo-secure-store";
import { scopedKey } from "./kv";

/**
 * Session for the API: the Cloudflare Access JWT obtained through the in-app
 * one-time-PIN login (see screens/Gates.tsx). Kept in the device keystore. The token is
 * sent as `cf-access-token`; Access validates it at the edge on every request.
 */
const KEY = scopedKey("fielder.accessToken");
let cached: string | null | undefined;
const listeners = new Set<() => void>();

function claims(token: string): { email?: string; exp?: number } | null {
  try {
    const part = token.split(".")[1];
    const pad = part.length % 4 === 0 ? "" : "=".repeat(4 - (part.length % 4));
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + pad)) as { email?: string; exp?: number };
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  if (cached === undefined) {
    try { cached = SecureStore.getItem(KEY); } catch { cached = null; }
  }
  return cached;
}

export function setToken(token: string | null) {
  cached = token;
  try {
    if (token) SecureStore.setItem(KEY, token);
    else void SecureStore.deleteItemAsync(KEY);
  } catch (e) { console.warn("secure store", e); }
  for (const fn of listeners) fn();
}

/** True while a token is present and not past its expiry (Access session, up to 30 days). */
export function isSignedIn(): boolean {
  const t = getToken();
  if (!t) return false;
  const c = claims(t);
  return !!c && (typeof c.exp !== "number" || c.exp * 1000 > Date.now());
}

export function signedInEmail(): string | null {
  const t = getToken();
  return t ? claims(t)?.email ?? null : null;
}

export function onAuthChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** When the Access session ends (from the token), or null when unknown. */
export function sessionExpiry(): Date | null {
  const t = getToken();
  const exp = t ? claims(t)?.exp : undefined;
  return typeof exp === "number" ? new Date(exp * 1000) : null;
}
