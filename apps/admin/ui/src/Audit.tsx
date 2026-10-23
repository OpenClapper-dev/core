/** The Audit tab (issue #224): every change an operator made in the admin plane, newest first, read-only. */
import { useEffect, useState } from "preact/hooks";
import { Button, Empty, Loading, ProjectTag } from "@openclapper/ui";
import { fetchAudit, type AuditEntry } from "./api";
import { bytes, Section } from "./shared";

const ACTION: Record<string, { label: string; icon: string }> = {
  "user.create": { label: "Account created", icon: "account-plus-outline" },
  "user.update": { label: "Account changed", icon: "pencil-outline" },
  "user.password": { label: "Password reset", icon: "key-variant" },
  "user.delete": { label: "Account deleted", icon: "delete-outline" },
  "settings.update": { label: "Settings changed", icon: "cog-outline" },
  "storage.repair": { label: "Object metadata repaired", icon: "tag-check-outline" },
};

const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** What changed, in words: the detail JSON of the row, by action. */
function detail(e: AuditEntry): string {
  const d = e.detail;
  if (e.action === "settings.update" && Array.isArray(d.storage_marks)) {
    const marks = d.storage_marks as { bytes: number; label: string }[];
    return marks.length ? `Storage marks: ${marks.map((m) => `${m.label} (${bytes(m.bytes)})`).join(", ")}` : "Storage marks removed";
  }
  if (e.action === "storage.repair") return `${String(d.repaired)} of ${String(d.checked)} objects rewritten${d.unknown ? `, ${String(d.unknown)} unknown left alone` : ""}`;
  const parts: string[] = [];
  if ("email" in d) parts.push(`email → ${String(d.email)}`);
  if ("name" in d) parts.push(d.name ? `name → ${String(d.name)}` : e.action === "user.create" ? "" : "name removed");
  if ("status" in d) parts.push(d.status === "blocked" ? "blocked" : "unblocked");
  return parts.filter(Boolean).join(" · ") || "—";
}

export function Audit() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<{ before: string; before_id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async (cursor: typeof next) => {
    setBusy(true);
    try {
      const page = await fetchAudit(cursor);
      setEntries((cur) => (cursor && cur ? [...cur, ...page.entries] : page.entries));
      setNext(page.next);
      setError(null);
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  };
  useEffect(() => { void load(null); }, []);

  if (error && !entries) return <Empty icon="cloud-alert" title="Could not load the audit trail" actions={<Button onClick={() => void load(null)}>Try again</Button>}>{error}</Empty>;
  if (!entries) return <Loading />;
  return (
    <Section icon="history" title="Audit trail" action={<Button size="sm" kind="ghost" icon="refresh" disabled={busy} onClick={() => void load(null)}>Refresh</Button>}>
      {entries.length === 0
        ? <div class="admin__pad"><span class="meta">Nothing yet: account and settings changes made here show up in this list.</span></div>
        : (
          <div class="admin__scroll">
            <table class="admin-table">
              <thead><tr><th>When</th><th>Operator</th><th>Action</th><th>Account</th><th>Details</th></tr></thead>
              <tbody>
                {entries.map((e) => {
                  const a = ACTION[e.action] ?? { label: e.action, icon: "information-outline" };
                  return (
                    <tr key={e.id}>
                      <td class="num" title={e.at}>{when(e.at)}</td>
                      <td>{e.operator_email}</td>
                      <td><ProjectTag icon={a.icon}>{a.label}</ProjectTag></td>
                      <td>{e.target_email ?? "—"}</td>
                      <td class="meta">{detail(e)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {next && <div class="admin__pad"><Button size="sm" kind="secondary" icon="chevron-down" disabled={busy} onClick={() => void load(next)}>Older entries</Button></div>}
      {error && <div class="admin__pad"><span class="meta">{error}</span></div>}
    </Section>
  );
}
