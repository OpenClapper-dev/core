/**
 * The auth seam (epic #107). index.ts imports the provider as `@fielder/auth-provider`, which
 * wrangler's `alias` (and tsconfig `paths`) map to `first-party.ts`. Another build swaps that one
 * line of config for its own module, e.g. one that wraps the first-party provider and checks a
 * subscription in `allow`. Workers are bundled at build time, so this is the whole plugin system.
 */
import type { Router } from "@fielder/service-kit";
import type { Env } from "../index.ts";

export interface Identity {
  userId: string;
  email: string;
}

/** Context of the routes that run before anyone is signed in (signing in, out). */
export interface PublicCtx {
  request: Request;
  env: Env;
  url: URL;
}

/** What a request is about to do, for `allow`: any change, or adding photos. */
export type Capability = "write" | "upload";

export interface AuthProvider {
  /** The request's user, or null (the Worker answers 401). */
  identify(request: Request, env: Env): Promise<Identity | null>;
  /** The provider's own public routes, under /api/auth/. */
  registerPublic(router: Router<PublicCtx>): void;
  /** Checked before every change; false answers 403. */
  allow(identity: Identity, capability: Capability, env: Env): Promise<boolean>;
}
