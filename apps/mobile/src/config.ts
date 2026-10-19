/** Build-time configuration: EXPO_PUBLIC_* variables, inlined into the bundle when it is built. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export const isConfigured = Boolean(API_URL);

/**
 * Separates the phone's stored data per server (kv.ts). Empty for production; `make mobile`
 * sets "local" so the local Worker never sees the production queue. Letters, digits and dashes only.
 */
export const STORAGE_SCOPE = (process.env.EXPO_PUBLIC_STORAGE_SCOPE ?? "").replace(/[^a-z0-9-]/gi, "");
