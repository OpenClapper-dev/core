/** The Audit tab (issue #224): every change an operator made in the admin plane, newest first, read-only. */
import { useEffect, useState } from "preact/hooks";
import { Badge, Button, EmptyState, Spinner, Table, type IconName } from "@openclapper/design";
import { fetchAudit, type AuditEntry } from "./api";
import { bytes, Section } from "./shared";

const ACTION: Record<string, { label: string; icon: IconName }> = {
  "user.create": { label: "Account created", icon: "plus" },
  "user.update": { label: "Account changed", icon: "edit" },
  "user.password": { label: "Password reset", icon: "lock" },
  "user.delete": { label: "Account deleted", icon: "trash" },
  "settings.update": { label: "Settings changed", icon: "settings" },
};

const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** What changed, in words: the detail JSON of the row, by action. */
function detail(e: AuditEntry): string {
  const d = e.detail;
  if (e.action === "settings.update" && Array.isArray(d.storage_marks)) {
    const marks = d.storage_marks as { bytes: number; label: string }[];
    return marks.length ? `Storage marks: ${marks.map((m) => `${m.label} (${bytes(m.bytes)})`).join(", ")}` : "Storage marks removed";
  }
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

  if (error && !entries) return <EmptyState icon="cloud-off" title="Could not load the audit trail">{error}<div className="adm-pad"><Button onClick={() => void load(null)}>Try again</Button></div></EmptyState>;
  if (!entries) return <div className="adm-center"><Spinner /></div>;
  return (
    <Section icon="history" title="Audit trail" action={<Button size="sm" variant="quiet" icon="refresh" disabled={busy} onClick={() => void load(null)}>Refresh</Button>}>
      {entries.length === 0
        ? <div className="adm-pad"><span className="adm-meta">Nothing yet: account and settings changes made here show up in this list.</span></div>
        : (
          <div className="adm-scroll">
            <Table columns={[{ key: "when", label: "When", mono: true, width: 200 }, { key: "op", label: "Operator" }, { key: "action", label: "Action" }, { key: "account", label: "Account" }, { key: "detail", label: "Details" }]}
              rows={entries.map((e) => {
                const a = ACTION[e.action] ?? { label: e.action, icon: "info" as IconName };
                return { id: e.id, when: <span title={e.at}>{when(e.at)}</span>, op: e.operator_email, action: <Badge icon={a.icon}>{a.label}</Badge>, account: e.target_email ?? "—", detail: <span className="adm-meta">{detail(e)}</span> };
              })} />
          </div>
        )}
      {next && <div className="adm-pad"><Button size="sm" variant="secondary" icon="chevron-down" disabled={busy} onClick={() => void load(next)}>Older entries</Button></div>}
      {error && <div className="adm-pad"><span className="adm-meta">{error}</span></div>}
    </Section>
  );
}
