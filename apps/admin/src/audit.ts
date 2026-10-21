/**
 * The admin audit trail (issue #224, migration 0025): who changed which account or setting, when.
 * Every mutating admin route adds `auditEntry` to the D1 batch of its change, so an action is never
 * recorded without happening or the other way round. The board shows it read-only (Audit tab).
 */
import { assertNumber, assertUuid, HttpError } from "@openclapper/service-kit";

export type AuditAction = "user.create" | "user.update" | "user.password" | "user.delete" | "settings.update";

export interface AuditEntry {
  id: string;
  at: string;
  operator_email: string;
  action: AuditAction;
  target_user_id: string | null;
  target_email: string | null;
  detail: Record<string, unknown>;
}

/** One row for the batch of the change it records. `detail` says what changed; it never holds a password. */
export function auditEntry(
  db: D1Database, operator: string, action: AuditAction,
  target: { userId?: string | null; email?: string | null }, detail: Record<string, unknown> = {},
): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO admin_audit (id, at, operator_email, action, target_user_id, target_email, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  ).bind(crypto.randomUUID(), new Date().toISOString(), operator, action, target.userId ?? null, target.email ?? null, JSON.stringify(detail));
}

export const AUDIT_PAGE = 50;
const AUDIT_MAX = 200;

/** Newest first, keyset-paged on (at, id) like the shot list: `before` + `before_id` from the previous page's `next`. */
export async function listAudit(db: D1Database, params: URLSearchParams): Promise<{ entries: AuditEntry[]; next: { before: string; before_id: string } | null }> {
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? AUDIT_PAGE : assertNumber(Number(rawLimit), "limit", { min: 1, max: AUDIT_MAX });
  const before = params.get("before");
  const beforeId = params.get("before_id");
  if ((before === null) !== (beforeId === null)) throw new HttpError(400, "before and before_id go together");
  if (before !== null && Number.isNaN(Date.parse(before))) throw new HttpError(400, "before must be an ISO 8601 timestamp");
  const cursor = before !== null ? { at: before, id: assertUuid(beforeId, "before_id") } : null;
  const { results } = await db.prepare(
    `SELECT id, at, operator_email, action, target_user_id, target_email, detail FROM admin_audit
     ${cursor ? "WHERE at < ?2 OR (at = ?2 AND id < ?3)" : ""}
     ORDER BY at DESC, id DESC LIMIT ?1`,
  ).bind(...(cursor ? [Math.floor(limit) + 1, cursor.at, cursor.id] : [Math.floor(limit) + 1])).all<Omit<AuditEntry, "detail"> & { detail: string }>();
  const page = results.slice(0, Math.floor(limit));
  const entries = page.map((r) => ({ ...r, detail: JSON.parse(r.detail) as Record<string, unknown> }));
  const last = page[page.length - 1];
  return { entries, next: results.length > page.length && last ? { before: last.at, before_id: last.id } : null };
}
