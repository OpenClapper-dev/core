/**
 * Password hashing for first-party sign-in (epic #107). Workers have no scrypt or argon2, so this is
 * PBKDF2-HMAC-SHA-256 from WebCrypto. Workers cap PBKDF2 at 100 000 iterations (about 16 ms of CPU,
 * more than the free plan's 10 ms per request), below what OWASP asks for. The stored string names
 * its iteration count, so changing the target only means rehashing on the next successful sign-in.
 */

/** The Workers maximum, and the default target. */
export const MAX_ITERATIONS = 100_000;
const MIN_ITERATIONS = 10_000;
const SCHEME = "pbkdf2-sha256";
const SALT_BYTES = 16;
const HASH_BITS = 256;

/** A hash nothing verifies against: the account cannot sign in with a password. */
export const NO_PASSWORD = "!";

/** The deployment's target (`PBKDF2_ITERATIONS` var; lower it on the free plan), clamped to what Workers allow. */
export function targetIterations(env: { PBKDF2_ITERATIONS?: string }): number {
  const n = Number(env.PBKDF2_ITERATIONS);
  return Number.isInteger(n) ? Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, n)) : MAX_ITERATIONS;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BITS));
}

/** `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>` */
export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  return `${SCHEME}$${iterations}$${b64(salt)}$${b64(await derive(password, salt, iterations))}`;
}

/** Same length and every byte looked at, so the time taken says nothing about where they differ. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * `needsRehash`: the password was right but hashed with another iteration count than the target.
 * A hash that cannot verify (`!`, malformed) still spends the time of a verification, so it does
 * not answer faster than a wrong password would.
 */
export async function verifyPassword(password: string, stored: string, target: number): Promise<{ ok: boolean; needsRehash: boolean }> {
  const [scheme, iter, salt, hash] = stored.split("$");
  const iterations = Number(iter);
  if (scheme !== SCHEME || !Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS || !salt || !hash) {
    await burnVerification(password, target);
    return { ok: false, needsRehash: false };
  }
  const ok = equalBytes(await derive(password, unb64(salt), iterations), unb64(hash));
  return { ok, needsRehash: ok && iterations !== target };
}

/** Spends the time of one verification without an account, so an unknown email answers as slowly as a wrong password. */
export async function burnVerification(password: string, target: number): Promise<void> {
  await derive(password, new Uint8Array(SALT_BYTES), target);
}

/** Rules for a new password: long enough to matter, short enough not to be a CPU sink. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string") return "password must be a string";
  if (password.length < 10) return "password must be at least 10 characters";
  if (password.length > 200) return "password must be at most 200 characters";
  return null;
}
