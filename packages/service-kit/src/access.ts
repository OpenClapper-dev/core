/**
 * Verifies the JWT Cloudflare Access injects as `Cf-Access-Jwt-Assertion`.
 * Access already enforces policy at the edge; this is defense in depth so the
 * Worker never serves a request that did not pass through Access for this app.
 * Docs: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */

export interface AccessIdentity {
  /** Email for identity logins; empty for service tokens. */
  email: string;
  /** Service token client id when authenticated via service token. */
  serviceTokenId?: string;
  kind: "user" | "service";
}

interface Jwk extends JsonWebKey {
  kid: string;
}

interface AccessClaims {
  aud: string | string[];
  iss: string;
  exp: number;
  nbf?: number;
  iat?: number;
  email?: string;
  sub?: string;
  common_name?: string;
  type?: string;
}

// Module-level cache. Workers isolates are reused across requests, so this
// avoids a JWKS fetch per request; Access rotates keys rarely.
let jwksCache: { fetchedAt: number; keys: Jwk[] } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getJwks(teamDomain: string, forceRefresh = false): Promise<Jwk[]> {
  if (!forceRefresh && jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { fetchedAt: Date.now(), keys: body.keys };
  return body.keys;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function decodeJson<T>(b64url: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(b64url))) as T;
}

async function verifySignature(jwt: string, key: Jwk): Promise<boolean> {
  const [h, p, s] = jwt.split(".");
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    key,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
}

export class AccessError extends Error {}

/**
 * Returns the authenticated identity or throws AccessError.
 * Never call this with `request` from an origin other than Cloudflare Access.
 */
export async function verifyAccessJwt(
  request: Request,
  env: { ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string },
): Promise<AccessIdentity> {
  // Unset, the JWKS URL would be "https:///…": a 500 per request instead of a refusal.
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new AccessError("Access is not configured");
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) throw new AccessError("missing Access JWT");

  const parts = jwt.split(".");
  if (parts.length !== 3) throw new AccessError("malformed JWT");

  let header: { alg?: string; kid?: string };
  let claims: AccessClaims;
  try {
    header = decodeJson(parts[0]);
    claims = decodeJson<AccessClaims>(parts[1]);
  } catch {
    throw new AccessError("undecodable JWT");
  }
  if (header.alg !== "RS256" || !header.kid) throw new AccessError("unsupported JWT header");

  // Find the signing key; refresh JWKS once if the kid is unknown (key rotation).
  let key = (await getJwks(env.ACCESS_TEAM_DOMAIN)).find((k) => k.kid === header.kid);
  if (!key) key = (await getJwks(env.ACCESS_TEAM_DOMAIN, true)).find((k) => k.kid === header.kid);
  if (!key) throw new AccessError("unknown signing key");

  if (!(await verifySignature(jwt, key))) throw new AccessError("bad signature");

  const now = Math.floor(Date.now() / 1000);
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(env.ACCESS_AUD)) throw new AccessError("audience mismatch");
  if (claims.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) throw new AccessError("issuer mismatch");
  if (typeof claims.exp !== "number" || claims.exp <= now) throw new AccessError("expired");
  if (typeof claims.nbf === "number" && claims.nbf > now + 60) throw new AccessError("not yet valid");

  if (claims.email) return { email: claims.email, kind: "user" };
  if (claims.common_name) return { email: "", serviceTokenId: claims.common_name, kind: "service" };
  throw new AccessError("no identity in JWT");
}
