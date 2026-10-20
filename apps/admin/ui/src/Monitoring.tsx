/**
 * The Monitoring tab (epic #67, issue #216): storage over time from the daily snapshots, every
 * workspace's share, and the operator's marks. Days are UTC; the bucket total is the bound bucket only.
 */
import { useState } from "preact/hooks";
import { Button, EmptyNote, IconButton, Input, Seg, Select, toast } from "@openclapper/ui";
import { putMarks, type Mark, type StorageReport } from "./api";
import { LineChart, Sparkline, type Point } from "./charts";
import { bytes, day, num, Section, Tile } from "./shared";

export type Range = 30 | 90 | 365;
export const RANGES: readonly { id: `${Range}`; label: string }[] = [{ id: "30", label: "30 d" }, { id: "90", label: "90 d" }, { id: "365", label: "1 y" }];

export function Monitoring({ report, range, onRange, onSaved }: { report: StorageReport; range: Range; onRange: (r: Range) => void; onSaved: () => Promise<void> }) {
  const totals: Point[] = report.days.filter((d) => d.total_objects > 0 || d.total_bytes > 0).map((d) => ({ day: d.day, value: d.total_bytes }));
  const perWorkspace = (id: string): Point[] => report.days.flatMap((d) => d.workspaces.filter((w) => w.workspace_id === id).map((w) => ({ day: d.day, value: w.bytes })));
  const photosBytes = report.workspaces.reduce((s, w) => s + w.bytes, 0);
  const photos = report.workspaces.reduce((s, w) => s + w.photos, 0);
  const unsized = report.workspaces.reduce((s, w) => s + w.unsized, 0);
  return (
    <>
      <div class="admin__tiles">
        <Tile label="Bucket" value={report.total ? bytes(report.total.bytes) : "—"} sub={report.total ? `${num(report.total.objects)} objects · as of ${day(report.total.day)} (UTC)` : "no snapshot yet"} />
        <Tile label="Photos" value={bytes(photosBytes)} sub={`${num(photos)} photos with a recorded size`} />
        <Tile label="Not in photos" value={report.total ? bytes(Math.max(0, report.total.bytes - photosBytes)) : "—"} sub="renders, orphans, photos without a size" />
        <Tile label="Unsized" value={num(unsized)} sub={unsized ? "photos from before sizes were recorded" : "every photo has a size"} />
      </div>
      <Section icon="chart-line" title="Storage" action={<Seg options={RANGES} value={`${range}`} label="Range" onChange={(v) => onRange(Number(v) as Range)} />}>
        <div class="admin__pad">
          <LineChart points={totals} marks={report.marks} format={bytes} label="Bucket total" />
          <p class="meta">The bound bucket, snapshotted once a day by the app's cron (UTC); it lags uploads and deletes by up to a day. Marks are yours (below).</p>
        </div>
      </Section>
      <Section icon="account-group-outline" title={`Workspaces · ${report.workspaces.length}`}>
        <div class="admin__scroll">
          <table class="admin-table">
            <thead><tr><th>Workspace</th><th>Owner</th><th>Photos</th><th>Storage</th><th>Share</th><th>Trend</th></tr></thead>
            <tbody>
              {report.workspaces.map((w) => (
                <tr key={w.id}>
                  <td><strong>{w.name}</strong>{w.kind === "personal" && <span class="meta"> personal</span>}</td>
                  <td>{w.owner_email ?? "—"}</td>
                  <td class="num">{num(w.photos)}</td>
                  <td class="num" title={w.unsized ? `${w.unsized} photos have no recorded size` : undefined}>{bytes(w.bytes)}{w.unsized ? " +" : ""}</td>
                  <td class="num">{photosBytes ? `${Math.round((w.bytes / photosBytes) * 100)} %` : "—"}</td>
                  <td><Sparkline points={perWorkspace(w.id)} format={bytes} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Marks marks={report.marks} onSaved={onSaved} />
    </>
  );
}

const UNITS = [{ value: "MB", label: "MB" }, { value: "GB", label: "GB" }] as const;
const SIZE: Record<string, number> = { MB: 1024 ** 2, GB: 1024 ** 3 };
interface Draft { amount: string; unit: string; label: string }
const toDraft = (m: Mark): Draft => (m.bytes % SIZE.GB === 0 || m.bytes >= SIZE.GB ? { amount: `${+(m.bytes / SIZE.GB).toFixed(2)}`, unit: "GB", label: m.label } : { amount: `${+(m.bytes / SIZE.MB).toFixed(1)}`, unit: "MB", label: m.label });
const toMark = (d: Draft): Mark | null => {
  const n = Number(d.amount);
  if (!Number.isFinite(n) || n <= 0 || !d.label.trim()) return null;
  return { bytes: Math.round(n * SIZE[d.unit]), label: d.label.trim() };
};

/** Byte thresholds with a label, at most 10. A crossed one shows as the banner on every tab. */
function Marks({ marks, onSaved }: { marks: Mark[]; onSaved: () => Promise<void> }) {
  const [drafts, setDrafts] = useState<Draft[]>(marks.map(toDraft));
  const [busy, setBusy] = useState(false);
  const parsed = drafts.map(toMark);
  const valid = parsed.every((m) => m !== null);
  const dirty = JSON.stringify(parsed) !== JSON.stringify(marks);
  const edit = (i: number, patch: Partial<Draft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const save = async () => {
    setBusy(true);
    try { const saved = await putMarks(parsed as Mark[]); setDrafts(saved.map(toDraft)); toast("Marks saved"); await onSaved(); } catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(false); }
  };
  return (
    <Section icon="flag-outline" title="Marks" action={<Button size="sm" icon="check" disabled={busy || !valid || !dirty} onClick={() => void save()}>Save</Button>}>
      <div class="admin__pad admin-marks">
        {!drafts.length && <EmptyNote title="No marks yet">A mark is a storage size you want to notice: a line on the chart, and a banner on the board once the bucket is past it. Say "5 GB" or "where I start paying"; there are no limits built in.</EmptyNote>}
        {drafts.map((d, i) => (
          <div class="admin-marks__row" key={i}>
            <Input sm type="number" min={0} step="any" placeholder="Size" value={d.amount} invalid={!toMark(d) && d.amount !== ""} onInput={(e) => edit(i, { amount: (e.target as HTMLInputElement).value })} boxStyle={{ width: 110 }} />
            <Select label="Unit" value={d.unit} options={UNITS} onChange={(unit) => edit(i, { unit })} width="84px" />
            <Input sm placeholder="Label" maxLength={40} value={d.label} onInput={(e) => edit(i, { label: (e.target as HTMLInputElement).value })} boxStyle={{ flex: "1 1 160px" }} />
            <IconButton icon="close" label="Remove mark" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))} />
          </div>
        ))}
        {drafts.length < 10 && <Button size="sm" kind="ghost" icon="plus" onClick={() => setDrafts([...drafts, { amount: "", unit: "GB", label: "" }])}>Add a mark</Button>}
      </div>
    </Section>
  );
}
