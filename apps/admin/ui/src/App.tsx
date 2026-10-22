import { useEffect, useState } from "preact/hooks";
import { Banner, Button, ConfirmHost, Empty, IconButton, InstanceBadge, instanceTitle, Loading, Mark, Seg, THEME_CYCLE, THEME_ICON, THEME_LABEL, toast, ToastHost, useTheme } from "@openclapper/ui";
import { Users } from "./Accounts";
import { Audit } from "./Audit";
import { fetchCloudflare, fetchOverview, fetchStorage, fetchUsers, fetchWorkspaces, whoami, type AdminUser, type AdminWorkspace, type CfOverlay, type Overview, type StorageReport } from "./api";
import { Monitoring, type Range } from "./Monitoring";
import { bytes, Tile } from "./shared";
import { Workspaces } from "./Workspaces";

type Tab = "board" | "monitoring" | "audit";
const TABS = [
  { id: "board", label: "Board", icon: "view-dashboard-outline" },
  { id: "monitoring", label: "Monitoring", icon: "chart-line" },
  { id: "audit", label: "Audit", icon: "history" },
] as const;
/** The tab title from index.html; whoami puts the instance in front of it ("staging · OpenClapper admin"). */
const BASE_TITLE = document.title;
const tabFromHash = (): Tab => (location.hash === "#monitoring" ? "monitoring" : location.hash === "#audit" ? "audit" : "board");

/**
 * The admin board (issue #116): instance totals, every account (create, block, reset the password,
 * delete) and every workspace with its size; a Monitoring tab (epic #67) with storage over time and
 * the operator's marks; an Audit tab (#224) with every change made here. Operators sign in through Cloudflare Access.
 */
export function App() {
  const [me, setMe] = useState<string | null>(null);
  const [instance, setInstance] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[] | null>(null);
  const [storage, setStorage] = useState<StorageReport | null>(null);
  const [overlay, setOverlay] = useState<CfOverlay | { configured: false } | null>(null);
  const [range, setRange] = useState<Range>(90);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useTheme();
  const load = () => Promise.all([whoami().then((w) => { setMe(w.email); setInstance(w.instance); document.title = instanceTitle(BASE_TITLE, w.instance); }), fetchOverview().then(setOverview), fetchUsers().then(setUsers), fetchWorkspaces().then(setWorkspaces), fetchStorage(range).then(setStorage)])
    .then(() => setError(null)).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  useEffect(() => { fetchStorage(range).then(setStorage).catch((e: Error) => toast(e.message, "danger")); }, [range]);
  // The overlay answers at most 31 days; a failure there (a bad token, Cloudflare down) is shown in place, never as a board error.
  useEffect(() => { fetchCloudflare(Math.min(range, 31)).then(setOverlay).catch((e: Error) => toast(`Cloudflare: ${e.message}`, "danger")); }, [range]);
  useEffect(() => {
    const sync = () => setTab(tabFromHash());
    addEventListener("hashchange", sync);
    return () => removeEventListener("hashchange", sync);
  }, []);
  const go = (t: Tab) => { location.hash = t === "board" ? "" : `#${t}`; setTab(t); };

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok); await load(); } catch (e) { toast((e as Error).message, "danger"); }
  };
  // The banner judges the larger of the two totals: the bucket's own snapshot, and the account-wide R2 total when the overlay is on (what is billed).
  const account = overlay?.configured ? overlay.r2.data?.total_bytes ?? null : null;
  const judged = storage?.total ? (account !== null && account > storage.total.bytes ? { bytes: account, what: "on the account" } : { bytes: storage.total.bytes, what: "in the bucket" }) : null;
  const crossed = judged ? (storage?.marks ?? []).filter((m) => judged.bytes >= m.bytes) : [];
  const worst = crossed[crossed.length - 1];

  return (
    <div class="admin">
      <header class="admin__head">
        <span class="admin__brand"><Mark size={24} surface="admin" />OpenClapper admin<InstanceBadge label={instance} /></span>
        <Seg options={TABS} value={tab} label="Page" onChange={go} />
        <span class="admin__headend">
          <span class="meta">{me ? `Signed in as ${me} (Cloudflare Access) · ` : ""}<span class="num">{__OPENCLAPPER_VERSION__} ({__OPENCLAPPER_COMMIT__})</span></span>
          <IconButton icon={THEME_ICON[theme]} label={THEME_LABEL[theme]} title={THEME_LABEL[theme]} onClick={() => setTheme(THEME_CYCLE[theme])} />
        </span>
      </header>
      {worst && judged && (
        <Banner kind="warn" icon="flag" role="alert" title={`Storage is past your mark "${worst.label}": ${bytes(judged.bytes)} ${judged.what}`}
          meta={crossed.length > 1 ? `Also past: ${crossed.slice(0, -1).map((m) => m.label).join(", ")}` : undefined}
          action={tab === "board" ? <Button size="sm" kind="ghost" onClick={() => go("monitoring")}>Monitoring</Button> : undefined} />
      )}
      {error && <Empty icon="cloud-alert" title="Could not load" actions={<Button onClick={() => void load()}>Try again</Button>}>{error}</Empty>}
      {!error && !overview && <Loading />}
      {tab === "board" && overview && (
        <div class="admin__tiles">
          <Tile label="Accounts" value={overview.users} sub={`${overview.active_30d} active in 30 days${overview.blocked ? ` · ${overview.blocked} blocked` : ""}`} />
          <Tile label="Workspaces" value={overview.workspaces} sub={`${overview.projects} projects`} />
          <Tile label="Shots" value={overview.shots} sub={`${overview.photos} photos`} />
          <Tile label="Storage" value={bytes(overview.bytes)} sub={overview.unsized ? `+ ${overview.unsized} photos from before sizes were recorded` : "photos in R2"} />
        </div>
      )}
      {tab === "board" && users && <Users users={users} act={act} />}
      {tab === "board" && workspaces && <Workspaces list={workspaces} />}
      {tab === "audit" && <Audit />}
      {tab === "monitoring" && storage && <Monitoring report={storage} overlay={overlay} range={range} onRange={setRange} onSaved={() => fetchStorage(range).then(setStorage)} />}
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}
