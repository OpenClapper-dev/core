/**
 * Tenancy (epic #107): who owns what. Every project and rig belongs to a workspace, every device and
 * viewfinder layout to a user; access is decided by workspace_members.
 */

/**
 * The owner of the data that existed before users did (migration 0021). Until requests carry a real
 * user (#109), new rows are attributed to it so nothing is created without an owner.
 */
export const BOOTSTRAP_USER_ID = "00000000-0000-4000-8000-000000000001";
export const BOOTSTRAP_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";

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
