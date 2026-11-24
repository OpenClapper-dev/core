import { HttpError } from "@openclapper/service-kit";

/**
 * Tenancy (epic #107): who owns what. Every project belongs to a workspace, and access to it and its
 * files is decided by workspace_members. A file of an account home belongs to one user (files.ts).
 */


export const ROLES = ["viewer", "editor", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];
/** Each role can do everything the ones before it can. */
export const RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export interface Tenant {
  userId: string;
  /** Workspace id → the caller's rank there. */
  ranks: Map<string, number>;
  /** The same workspace ids as a JSON array, for `IN (SELECT value FROM json_each(?))`. */
  wsList: string;
}

/**
 * The caller's memberships, read on every request: a revoked membership must stop working at once,
 * so it is not cached.
 */
export async function loadTenant(env: { DB: D1Database }, userId: string): Promise<Tenant> {
  const { results } = await env.DB.prepare("SELECT workspace_id, role FROM workspace_members WHERE user_id = ?1")
    .bind(userId).all<{ workspace_id: string; role: Role }>();
  const ranks = new Map(results.map((m) => [m.workspace_id, RANK[m.role]]));
  return { userId, ranks, wsList: JSON.stringify([...ranks.keys()]) };
}

/** What a by-id access check needs from the request context. */
export interface Access {
  env: { DB: D1Database };
  tenant: Tenant;
}

/**
 * Each owned kind → SQL from one id up to its workspace (no row = the id does not exist). Files are
 * checked in files.ts, which also knows the account homes.
 */
const WORKSPACE_OF = {
  project: "SELECT workspace_id AS ws FROM projects WHERE id = ?1",
} as const;
export type Owned = keyof typeof WORKSPACE_OF;

/** The workspace a row belongs to; undefined when there is no such row. */
export async function workspaceOf(env: Access["env"], kind: Owned, id: string): Promise<string | null | undefined> {
  const row = await env.DB.prepare(WORKSPACE_OF[kind]).bind(id).first<{ ws: string | null }>();
  return row ? row.ws : undefined;
}

/** Throws unless the caller has at least `min` in the workspace: 404 when not a member (nothing to see), 403 when the role is too low. */
export function assertRank(a: Access, workspaceId: string | null | undefined, min: Role, what = "not found"): string {
  const rank = workspaceId ? a.tenant.ranks.get(workspaceId) : undefined;
  if (rank === undefined) throw new HttpError(404, what);
  if (rank < RANK[min]) throw new HttpError(403, `needs the ${min} role in this workspace`);
  return workspaceId!;
}

/**
 * The by-id check of every route: the row exists and its workspace grants `min`. Another
 * workspace's row answers like a missing one (404), so ids reveal nothing. Returns the workspace id.
 */
export async function assertAccess(a: Access, kind: Owned, id: string, min: Role): Promise<string> {
  return assertRank(a, await workspaceOf(a.env, kind, id), min, `${kind} not found`);
}

/**
 * For upserts: null when the row does not exist yet (the caller creates it), else as assertAccess.
 * A PUT must never overwrite another workspace's row because it knows the id.
 */
export async function accessIfExists(a: Access, kind: Owned, id: string, min: Role): Promise<string | null> {
  const ws = await workspaceOf(a.env, kind, id);
  return ws === undefined ? null : assertRank(a, ws, min, `${kind} not found`);
}

/**
 * A row named in a body (a new file's project). Unknown and foreign both
 * answer 400 "<kind>_id does not exist", as before tenancy, so a phone's upload to a project it cannot
 * reach parks as stuck. Returns the workspace id.
 */
export async function assertRef(a: Access, kind: Owned, id: string, min: Role = "editor"): Promise<string> {
  const ws = await workspaceOf(a.env, kind, id);
  if (!ws || !a.tenant.ranks.has(ws)) throw new HttpError(400, `${kind}_id does not exist`);
  return assertRank(a, ws, min);
}

export const assertProjectRef = (a: Access, projectId: string, min: Role = "editor") => assertRef(a, "project", projectId, min);

/** SQL condition: `column` is one of the caller's workspaces; bind `tenant.wsList` at `?n`. */
export const inWorkspaces = (column: string, n: number) => `${column} IN (SELECT value FROM json_each(?${n}))`;

/**
 * Where a new top-level row goes when the body names no workspace: the caller's own (personal)
 * workspace, else the first one they can edit.
 */
export async function defaultWorkspace(a: Access): Promise<string> {
  const own = await a.env.DB.prepare("SELECT id FROM workspaces WHERE owner_user_id = ?1 AND kind = 'personal' ORDER BY created_at LIMIT 1")
    .bind(a.tenant.userId).first<{ id: string }>();
  if (own && (a.tenant.ranks.get(own.id) ?? -1) >= RANK.editor) return own.id;
  for (const [ws, rank] of a.tenant.ranks) if (rank >= RANK.editor) return ws;
  throw new HttpError(403, "no workspace you can create in");
}
