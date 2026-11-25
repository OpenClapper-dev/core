import { useEffect, useState } from "preact/hooks";
import { Banner, Button, EmptyState, EnvMarker, Segmented, Spinner } from "@openclapper/design";
import { Users } from "./Accounts";
import { Audit } from "./Audit";
import { fetchCloudflare, fetchOverview, fetchStorage, fetchUsers, fetchWorkspaces, whoami, type AdminUser, type AdminWorkspace, type CfOverlay, type Overview, type StorageReport } from "./api";
import { Hosts, toast } from "./hosts";
import { Monitoring, type Range } from "./Monitoring";
import { bytes, Tile } from "./shared";
import { GLYPH, LABEL, NEXT, useTheme } from "./theme";
import { Workspaces } from "./Workspaces";

type Tab = "board" | "monitoring" | "audit";
const TABS = [
  { value: "board", label: "Board", icon: "grid" },
  { value: "monitoring", label: "Monitoring", icon: "histogram" },
  { value: "audit", label: "Audit", icon: "history" },
] as const;
/** The tab title from index.html; whoami puts the instance in front of it ("staging · OpenClapper admin"). */
const BASE_TITLE = document.title;
const tabFromHash = (): Tab => (location.hash === "#monitoring" ? "monitoring" : location.hash === "#audit" ? "audit" : "board");
/** The instance as an environment mark (colour and label): none set is production; the dev server is development. */
const envOf = (instance: string) => (!instance || instance === "production" ? "production" : instance === "staging" ? "staging" : "development");
/** The instance's own icon, the one index.html links; a build served locally (the admin Worker on :8788) switches to the development set. */
const linked = (document.querySelector('link[rel="icon"]') as HTMLLinkElement | null)?.href ?? "";
const iconFor = (env: string) => (env === "development" ? linked.replace(/\/icons\/[^/]+\//, "/icons/dev/") : linked);

/**
 * The admin board (issue #116): instance totals, every account (create, block, reset the password,
 * delete) and every workspace with its size; a Monitoring tab (epic #67) with storage over time and
 * the operator's marks; an Audit tab (#224) with every change made here. Operators sign in through Cloudflare Access.
 * On the rebuilt app's design system (#426), like the Studio.
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
  const load = () => Promise.all([whoami().then((w) => { setMe(w.email); setInstance(w.instance); document.title = w.instance ? `${w.instance} · ${BASE_TITLE}` : BASE_TITLE; }), fetchOverview().then(setOverview), fetchUsers().then(setUsers), fetchWorkspaces().then(setWorkspaces), fetchStorage(range).then(setStorage)])
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
  const env = import.meta.env.DEV ? "development" : envOf(instance);
  useEffect(() => { document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((l) => { l.href = env === "development" ? l.href.replace(/\/icons\/[^/]+\//, "/icons/dev/") : l.href; }); }, [env]);
  const go = (t: Tab) => { location.hash = t === "board" ? "" : `#${t}`; setTab(t); };

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok, "success"); await load(); } catch (e) { toast((e as Error).message, "danger"); }
  };
  // The banner judges the larger of the two totals: the bucket's own snapshot, and the account-wide R2 total when the overlay is on (what is billed).
  const account = overlay?.configured ? overlay.r2.data?.total_bytes ?? null : null;
  const judged = storage?.total ? (account !== null && account > storage.total.bytes ? { bytes: account, what: "on the account" } : { bytes: storage.total.bytes, what: "in the bucket" }) : null;
  const crossed = judged ? (storage?.marks ?? []).filter((m) => judged.bytes >= m.bytes) : [];
  const worst = crossed[crossed.length - 1];

  return (
    <div className="adm">
      <header className="adm-head">
        <span className="adm-brand">{linked && <img src={iconFor(env)} alt="" width={24} height={24} />}OpenClapper admin<EnvMarker env={env} /></span>
        <Segmented label="Page" value={tab} onChange={(v: string) => go(v as Tab)} options={TABS.map((t) => ({ ...t }))} />
        <span className="adm-head__end">
          <span className="adm-meta">{me ? `Signed in as ${me} (Cloudflare Access) · ` : ""}<span className="adm-num">{__OPENCLAPPER_VERSION__} ({__OPENCLAPPER_COMMIT__})</span></span>
          <Button size="sm" variant="quiet" icon={GLYPH[theme]} label={LABEL[theme]} title={LABEL[theme]} onClick={() => setTheme(NEXT[theme])} />
        </span>
      </header>
      {worst && judged && (
        <Banner tone="warning" icon="flag" role="alert" title={`Storage is past your mark "${worst.label}": ${bytes(judged.bytes)} ${judged.what}`}
          action={tab === "board" ? <Button size="sm" variant="quiet" onClick={() => go("monitoring")}>Monitoring</Button> : undefined}>
          {crossed.length > 1 ? `Also past: ${crossed.slice(0, -1).map((m) => m.label).join(", ")}` : undefined}
        </Banner>
      )}
      {error && <EmptyState icon="cloud-off" title="Could not load">{error}<div className="adm-pad"><Button onClick={() => void load()}>Try again</Button></div></EmptyState>}
      {!error && !overview && <div className="adm-center"><Spinner /></div>}
      {tab === "board" && overview && (
        <div className="adm-tiles">
          <Tile label="Accounts" value={overview.users} sub={`${overview.active_30d} active in 30 days${overview.blocked ? ` · ${overview.blocked} blocked` : ""}`} />
          <Tile label="Workspaces" value={overview.workspaces} sub={`${overview.projects} projects`} />
          <Tile label="Files" value={overview.files} sub={`${overview.photos} photos`} />
          <Tile label="Storage" value={bytes(overview.bytes)} sub={overview.unsized ? `+ ${overview.unsized} photos from before sizes were recorded` : "photos in R2"} />
        </div>
      )}
      {tab === "board" && users && <Users users={users} act={act} />}
      {tab === "board" && workspaces && <Workspaces list={workspaces} />}
      {tab === "audit" && <Audit />}
      {tab === "monitoring" && storage && <Monitoring report={storage} overlay={overlay} range={range} onRange={setRange} onSaved={() => fetchStorage(range).then(setStorage)} />}
      <Hosts />
    </div>
  );
}
