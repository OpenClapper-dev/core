import { assertEnum, assertString, assertUuid, HttpError, json, readJson, type Router } from "@openclapper/service-kit";
import type { Ctx } from "./index.ts";
import { assertRank, RANK, ROLES, type Role } from "./tenancy.ts";

interface MemberRow { user_id: string; email: string; name: string | null; role: Role; created_at: string }

/**
 * Workspaces and their members (epic #107). Every user has a personal workspace and can be invited
 * into others on the same instance; there is no sign-up, so an invite names an existing account.
 * Roles: viewer reads, editor changes content, admin also manages editors and viewers, owner also
 * manages admins. Ownership itself does not change here (the owner cannot be removed or demoted).
 */
export function registerWorkspaceRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/workspaces", async ({ env, tenant }) => {
    const { results } = await env.DB.prepare(
      `SELECT w.id, w.name, m.role, (w.kind = 'personal' AND w.owner_user_id = ?1) AS personal, w.created_at,
         (SELECT count(*) FROM workspace_members x WHERE x.workspace_id = w.id) AS member_count,
         (SELECT count(*) FROM projects p WHERE p.workspace_id = w.id) AS project_count
       FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = ?1 ORDER BY personal DESC, w.name COLLATE NOCASE`,
    ).bind(tenant.userId).all<{ personal: number }>();
    return json({ workspaces: results.map((w) => ({ ...w, personal: w.personal === 1 })) });
  });

  /** A new shared workspace, owned by the caller: JSON { id, name }. */
  r.on("PUT", "/api/workspaces/:id", async (ctx, { id }) => {
    const { env, tenant, request } = ctx;
    const wid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 80);
    const exists = await env.DB.prepare("SELECT 1 FROM workspaces WHERE id = ?1").bind(wid).first();
    if (exists) {
      assertRank(ctx, wid, "admin", "workspace not found");
      await env.DB.prepare("UPDATE workspaces SET name = ?2, updated_at = ?3 WHERE id = ?1").bind(wid, name, new Date().toISOString()).run();
    } else {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO workspaces (id, name, owner_user_id) VALUES (?1, ?2, ?3)").bind(wid, name, tenant.userId),
        env.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, 'owner')").bind(wid, tenant.userId),
      ]);
    }
    return json({ workspace: { id: wid, name } }, exists ? 200 : 201);
  });

  r.on("GET", "/api/workspaces/:id/members", async (ctx, { id }) => {
    const wid = assertUuid(id, "id");
    assertRank(ctx, wid, "viewer", "workspace not found");
    const { results } = await ctx.env.DB.prepare(
      `SELECT m.user_id, u.email, u.name, m.role, m.created_at FROM workspace_members m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ?1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, u.email COLLATE NOCASE`,
    ).bind(wid).all<MemberRow>();
    return json({ members: results });
  });

  /**
   * Add or re-role a member: JSON { email, role } (role: admin, editor or viewer). An admin manages
   * editors and viewers; making, changing or removing an admin needs the owner.
   */
  r.on("POST", "/api/workspaces/:id/members", async (ctx, { id }) => {
    const { env, request } = ctx;
    const wid = assertUuid(id, "id");
    assertRank(ctx, wid, "admin", "workspace not found");
    const b = await readJson<Record<string, unknown>>(request);
    const email = assertString(b.email, "email", 320);
    const role = assertEnum(b.role, "role", ROLES.filter((x) => x !== "owner"));
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?1 COLLATE NOCASE AND status = 'active'").bind(email).first<{ id: string }>();
    if (!user) throw new HttpError(404, "no account with this email on this instance");
    const cur = await env.DB.prepare("SELECT role FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2").bind(wid, user.id).first<{ role: Role }>();
    assertCanManage(ctx, wid, cur?.role ?? null, role);
    await env.DB.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?1, ?2, ?3)
       ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = ?3`,
    ).bind(wid, user.id, role).run();
    return json({ member: { user_id: user.id, role } }, cur ? 200 : 201);
  });

  /** Remove a member, or leave (your own id). The owner cannot leave or be removed. */
  r.on("DELETE", "/api/workspaces/:id/members/:user", async (ctx, { id, user }) => {
    const { env, tenant } = ctx;
    const wid = assertUuid(id, "id");
    const uid = assertUuid(user, "user");
    assertRank(ctx, wid, "viewer", "workspace not found");
    const cur = await env.DB.prepare("SELECT role FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2").bind(wid, uid).first<{ role: Role }>();
    if (!cur) throw new HttpError(404, "not a member");
    if (cur.role === "owner") throw new HttpError(400, "the owner cannot leave or be removed");
    if (uid !== tenant.userId) assertCanManage(ctx, wid, cur.role, null);
    await env.DB.prepare("DELETE FROM workspace_members WHERE workspace_id = ?1 AND user_id = ?2").bind(wid, uid).run();
    return json({ removed: uid });
  });
}

/** `from` → `to` (null = not a member) must stay below the caller: admins manage editors and viewers, the owner also admins. */
function assertCanManage(ctx: Ctx, wid: string, from: Role | null, to: Role | null) {
  if (from === "owner") throw new HttpError(400, "the owner's role does not change here");
  const mine = ctx.tenant.ranks.get(wid) ?? -1;
  const needs = Math.max(RANK[from ?? "viewer"], RANK[to ?? "viewer"]) >= RANK.admin ? RANK.owner : RANK.admin;
  if (mine < needs) throw new HttpError(403, needs === RANK.owner ? "only the owner manages admins" : "needs the admin role in this workspace");
}
