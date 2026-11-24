// The Devices app (docs/features/camera-layouts.md, "Devices"; docs/rewrite/ux-6-devices.md): the account's registered
// hardware. In the core that is its phones and tablets, which register themselves; the Hardware extension (step B9)
// adds lights, batteries, cameras and transmitters to the same registry. Whatever is set on a phone or tablet can be
// set here: its tabs and its camera layout; "Take the setup of another device" copies both. Two views: cards across
// the full width with what a device exposes, and a table.
import "../layouts/layouts.css";
import { useEffect, useState } from "preact/hooks";
import {
  AppIcon, Badge, Button, Checkbox, DropdownMenu, EmptyState, Icon, Segmented, Select, Spinner, Table, TextInput, Toolbar, ToolbarSpacer, cx, type IconName,
} from "@openclapper/design";
import { BUILTIN_LAYOUTS } from "@openclapper/model";
import * as api from "../api";
import type { FileRec } from "../api";
import * as store from "../files";
import { confirm, toast, toastError } from "../hosts";
import { sendLink, usePhoneLink } from "../phoneLink";
import type { AppProps } from "./registry";

/** The apps a phone or tablet can show as tabs (its touch forms); Setup is always the last and not listed. */
const PHONE_APPS: [string, string, IconName][] = [["camera", "Camera", "camera"], ["media", "Media", "image"], ["shots", "Shots", "slate"], ["sets", "Sets", "home"], ["locations", "Locations", "location"], ["canvas", "Canvas", "brush"]];
interface DeviceBody { kind: "phone" | "tablet"; make: string; model: string; lenses: { id: string; name: string; focal35: number | null }[]; screen: { portrait: { w: number; h: number } } | null; camera?: { portrait: { w: number; h: number }; landscape: { w: number; h: number } } | null; tabs: string[]; app: string; layout?: string }

export function DevicesApp({ setTitle }: AppProps) {
  const { files } = store.useRoot("home");
  const link = usePhoneLink();
  const [view, setView] = useState("cards");
  useEffect(() => { setTitle("Devices"); }, []);
  if (!files) return <div className="oc-app st-center"><Spinner /></div>;
  const devices = files.filter((f) => f.type === "device").sort((a, b) => a.name.localeCompare(b.name));
  const layouts = files.filter((f) => f.type === "layout");
  const connected = (d: FileRec) => link.phones.some((p) => p.id === d.id);
  return (
    <div className="oc-app">
      <Toolbar>
        <Icon name="mobile" size={20} /><strong className="st-title">Devices</strong>
        <Badge>{devices.length} registered</Badge>
        <ToolbarSpacer />
        <span className={cx("lay-pill", link.phones.length ? "is-connected" : "is-none")} title="The phone link: which of your phones and tablets have the app open now"><i />{!link.open ? "Phone link offline" : link.phones.length ? `${link.phones.length} connected now` : "None connected now"}</span>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: "cards", icon: "grid", title: "Cards" }, { value: "table", icon: "list", title: "Table" }]} />
      </Toolbar>
      <div className="dev-body">
        {!devices.length ? <EmptyState icon="mobile" title="No devices yet">A phone or tablet registers itself the first time the app runs signed in to this account.</EmptyState>
          : view === "table" ? (
            <Table columns={[{ key: "name", label: "Name" }, { key: "type", label: "Type", width: 110 }, { key: "model", label: "Model" }, { key: "link", label: "Connection", width: 150 }, { key: "layout", label: "Camera layout" }, { key: "app", label: "App", width: 110, mono: true }]}
              rows={devices.map((d) => { const b = d.body as unknown as DeviceBody; return {
                id: d.id, name: d.name, type: <span className="dev-type"><AppIcon glyph={b.kind === "tablet" ? "tablet" : "mobile"} color={6} size={16} />{b.kind === "tablet" ? "Tablet" : "Phone"}</span>, model: `${b.make} ${b.model}`,
                link: <span className="dev-link"><i className={cx(connected(d) && "is-on")} />{connected(d) ? "Connected" : "Registered"}</span>, layout: layoutName(b.layout, layouts), app: b.app,
              }; })} />
          ) : <div className="dev-cards">{devices.map((d) => <Card key={d.id} d={d} devices={devices} layouts={layouts} connected={connected(d)} />)}</div>}
      </div>
    </div>
  );
}

const layoutName = (id: string | undefined, layouts: FileRec[]) => (id === "camera" || id === "viewfinder" ? BUILTIN_LAYOUTS[id].name : layouts.find((l) => l.id === id)?.name ?? (id ? "A layout that is gone (Viewfinder)" : "Viewfinder"));

function Card({ d, devices, layouts, connected }: { d: FileRec; devices: FileRec[]; layouts: FileRec[]; connected: boolean }) {
  const b = d.body as unknown as DeviceBody;
  const [name, setName] = useState(d.name);
  const save = (change: Partial<DeviceBody>) => void api.putFile(d.id, { body: { ...b, ...change } }).then(() => store.loadRoot("home"), toastError);
  const tabs = b.tabs.filter((t) => t !== "setup");
  const setTabs = (t: string[]) => save({ tabs: [...t, "setup"] });
  const move = (id: string, dir: -1 | 1) => { const i = tabs.indexOf(id), j = i + dir; if (j < 0 || j >= tabs.length) return; const n = [...tabs]; [n[i], n[j]] = [n[j], n[i]]; setTabs(n); };
  const others = devices.filter((x) => x.id !== d.id);
  const take = (from: FileRec) => { const fb = from.body as unknown as DeviceBody; save({ tabs: fb.tabs, layout: fb.layout ?? "viewfinder" }); toast(`“${d.name}” has the tabs and camera layout of “${from.name}” now`, { tone: "info" }); };
  const remove = async () => {
    if (!(await confirm({ danger: true, title: `Remove “${d.name}”?`, message: "It goes to the recycle bin. When the app runs on it again, it registers again with its tabs and layout as they were.", confirmLabel: "Remove" }))) return;
    try { await store.bin("home", [d.id]); } catch (e) { toastError(e); }
  };
  const rename = () => { const to = name.trim(); if (!to || to === d.name) { setName(d.name); return; } void store.rename(d, to).catch(toastError); };
  return (
    <section className="dev-card">
      <header className="dev-card__head">
        <AppIcon glyph={b.kind === "tablet" ? "tablet" : "mobile"} color={6} size={32} />
        <span className="dev-card__who">
          <TextInput size="sm" value={name} aria-label="Name" maxLength={120} onInput={(e) => setName(e.currentTarget.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          <small>{b.kind === "tablet" ? "Tablet" : "Phone"} · {b.make} {b.model} · app {b.app || "?"}</small>
        </span>
        <span className="dev-link"><i className={cx(connected && "is-on")} />{connected ? "Connected" : "Registered"}</span>
        <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "readout", label: "Read out again", icon: "refresh", disabled: !connected }, { separator: true }, { id: "remove", label: "Remove…", icon: "trash", danger: true }]}
          onSelect={(x) => (x === "readout" ? sendLink({ ch: "link", type: "readout" }) : void remove())} />
      </header>
      <div className="dev-card__grid">
        <div>
          <h4>What it reported</h4>
          <p className="dev-fact">Screen {b.screen ? `${b.screen.portrait.w} × ${b.screen.portrait.h}` : "unknown"}{b.camera ? ` · camera area ${b.camera.portrait.w} × ${b.camera.portrait.h}` : ""}</p>
          <p className="dev-fact">{b.lenses.length ? b.lenses.map((l) => `${l.name}${l.focal35 ? ` (${l.focal35} mm)` : " (no focal length)"}`).join(", ") : "No lenses reported yet"}</p>
        </div>
        <div>
          <h4>Tabs</h4>
          <ul className="dev-tabs">
            {tabs.map((t, i) => { const a = PHONE_APPS.find(([id]) => id === t); return (
              <li key={t}><Checkbox checked onChange={() => setTabs(tabs.filter((x) => x !== t))}>{a?.[1] ?? t}</Checkbox><span style={{ flex: 1 }} />
                <Button size="sm" variant="quiet" icon="arrow-up" label="Earlier" disabled={i === 0} onClick={() => move(t, -1)} /><Button size="sm" variant="quiet" icon="arrow-down" label="Later" disabled={i === tabs.length - 1} onClick={() => move(t, 1)} /></li>
            ); })}
            {PHONE_APPS.filter(([id]) => !tabs.includes(id)).map(([id, label]) => <li key={id} className="is-off"><Checkbox checked={false} onChange={() => setTabs([...tabs, id])}>{label}</Checkbox></li>)}
            <li className="is-fixed"><Icon name="settings" size={14} />Setup, always last</li>
          </ul>
        </div>
        <div>
          <h4>Camera layout</h4>
          <Select size="sm" value={b.layout ?? "viewfinder"} onChange={(v) => save({ layout: v })} options={[{ value: "camera", label: "Camera (built in)" }, { value: "viewfinder", label: "Viewfinder (built in)" }, ...layouts.map((l) => ({ value: l.id, label: l.name }))]} />
          {others.length > 0 && (
            <div className="dev-take">
              <h4>Take the setup of another device</h4>
              <DropdownMenu size="sm" variant="secondary" icon="copy" label="Its tabs and layout from…" items={others.map((o) => ({ id: o.id, label: o.name }))} onSelect={(id) => take(others.find((o) => o.id === id)!)} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
