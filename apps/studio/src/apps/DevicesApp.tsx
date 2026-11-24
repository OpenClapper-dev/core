// The Devices app (docs/features/camera-layouts.md, "Devices"; docs/features/hardware.md; docs/rewrite/ux-6-devices.md):
// the account's registered hardware. In the core that is its phones and tablets, which register themselves; an
// extension adds its kinds to the same registry (devices.ts: the Hardware extension's lights, batteries, cameras and
// transmitters) while the project has it on. Whatever is set on a phone or tablet can be set here: its tabs and its
// camera layout; "Take the setup of another device" copies both. Two views: cards across the full width with what a
// device exposes, ready to use, and a table. State shows in colour.
import "../layouts/layouts.css";
import { useEffect, useState } from "preact/hooks";
import {
  AppIcon, Badge, Button, Checkbox, ConnectionMark, DeviceCard, DropdownMenu, EmptyState, Icon, Segmented, Select, Spinner, Table, TextInput, Toolbar, ToolbarSpacer, cx, type IconName,
} from "@openclapper/design";
import { BUILTIN_LAYOUTS, extensionDef } from "@openclapper/model";
import * as api from "../api";
import type { FileRec } from "../api";
import { deviceViews, phoneTabs } from "../devices";
import * as store from "../files";
import { confirm, toast, toastError } from "../hosts";
import { sendLink, usePhoneLink } from "../phoneLink";
import { extensionOn, type AppProps } from "./registry";

/** The core's apps a phone or tablet can show as tabs (its touch forms); Setup is always the last and not listed. */
const CORE_TABS: [string, string, IconName][] = [["camera", "Camera", "camera"], ["media", "Media", "image"], ["shots", "Shots", "slate"], ["sets", "Sets", "home"], ["locations", "Locations", "location"], ["canvas", "Canvas", "brush"]];
interface DeviceBody { kind: "phone" | "tablet"; make: string; model: string; lenses: { id: string; name: string; focal35: number | null }[]; screen: { portrait: { w: number; h: number } } | null; camera?: { portrait: { w: number; h: number }; landscape: { w: number; h: number } } | null; tabs: string[]; app: string; layout?: string }
const isPhone = (f: FileRec) => { const k = (f.body as { kind?: unknown } | undefined)?.kind; return k === "phone" || k === "tablet"; };

export function DevicesApp({ setTitle }: AppProps) {
  const { files } = store.useRoot("home");
  const link = usePhoneLink();
  const [view, setView] = useState("cards");
  useEffect(() => { setTitle("Devices"); }, []);
  const all = (files ?? []).filter((f) => f.type === "device").sort((a, b) => a.name.localeCompare(b.name));
  // Every registered view's hook runs on every render, in the same order (the registry is fixed at start).
  const ctxs = deviceViews().map((v) => v.useContext(all));
  if (!files) return <div className="oc-app st-center"><Spinner /></div>;
  const layouts = files.filter((f) => f.type === "layout");
  const phones = all.filter(isPhone);
  const shown = deviceViews().map((v, i) => ({ v, ctx: ctxs[i], on: extensionOn(v.extension), devices: all.filter((d) => v.kinds.includes(String((d.body as { kind?: unknown }).kind))) }));
  const hidden = shown.filter((x) => !x.on && x.devices.length);
  const devices = [...phones, ...shown.filter((x) => x.on).flatMap((x) => x.devices)];
  const connected = (d: FileRec) => link.phones.some((p) => p.id === d.id);
  const viewOf = (d: FileRec) => shown.find((x) => x.on && x.devices.includes(d));
  return (
    <div className="oc-app">
      <Toolbar>
        <Icon name="mobile" size={20} /><strong className="st-title">Devices</strong>
        <Badge>{devices.length} registered</Badge>
        <ToolbarSpacer />
        {shown.filter((x) => x.on && x.v.Toolbar).map((x, i) => { const T = x.v.Toolbar!; return <T key={i} files={all} ctx={x.ctx} />; })}
        <span className={cx("lay-pill", link.phones.length ? "is-connected" : "is-none")} title="The phone link: which of your phones and tablets have the app open now"><i />{!link.open ? "Phone link offline" : link.phones.length ? `${link.phones.length} connected now` : "None connected now"}</span>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: "cards", icon: "grid", title: "Cards" }, { value: "table", icon: "list", title: "Table" }]} />
      </Toolbar>
      <div className="dev-body">
        {hidden.length > 0 && <p className="dev-hidden">{hidden.map((x) => `${x.devices.length} device${x.devices.length === 1 ? "" : "s"} need${x.devices.length === 1 ? "s" : ""} the ${extensionDef(x.v.extension)?.name ?? x.v.extension} extension, which this project has off.`).join(" ")}</p>}
        {!devices.length ? <EmptyState icon="mobile" title="No devices yet">A phone or tablet registers itself the first time the app runs signed in to this account.</EmptyState>
          : view === "table" ? (
            <Table columns={[{ key: "name", label: "Name" }, { key: "type", label: "Type", width: 150 }, { key: "model", label: "Model" }, { key: "link", label: "Connection", width: 190 }, { key: "battery", label: "Battery", width: 140 }, { key: "power", label: "Power or layout" }]}
              rows={devices.map((d) => {
                const x = viewOf(d);
                if (x) return { id: d.id, name: d.name, ...x.v.cells(d, all, x.ctx) };
                const b = d.body as unknown as DeviceBody;
                return {
                  id: d.id, name: d.name, type: <span className="dev-type"><AppIcon glyph={b.kind === "tablet" ? "tablet" : "mobile"} color={6} size={16} />{b.kind === "tablet" ? "Tablet" : "Phone"}</span>, model: `${b.make} ${b.model}`,
                  link: <ConnectionMark tone={connected(d) ? "ok" : "off"} label={connected(d) ? "Connected" : "Registered"} />, battery: "", power: layoutName(b.layout, layouts),
                };
              })} />
          ) : (
            <div className="dev-cards">
              {phones.map((d) => <PhoneCard key={d.id} d={d} devices={phones} layouts={layouts} connected={connected(d)} />)}
              {shown.filter((x) => x.on).flatMap((x) => x.devices.map((d) => { const C = x.v.Card; return <C key={d.id} d={d} all={all} ctx={x.ctx} />; }))}
            </div>
          )}
      </div>
    </div>
  );
}

const layoutName = (id: string | undefined, layouts: FileRec[]) => (id === "camera" || id === "viewfinder" ? BUILTIN_LAYOUTS[id].name : layouts.find((l) => l.id === id)?.name ?? (id ? "A layout that is gone (Viewfinder)" : "Viewfinder"));

/** A phone or tablet: what it reported, its tabs and its camera layout. */
function PhoneCard({ d, devices, layouts, connected }: { d: FileRec; devices: FileRec[]; layouts: FileRec[]; connected: boolean }) {
  const b = d.body as unknown as DeviceBody;
  const [name, setName] = useState(d.name);
  const save = (change: Partial<DeviceBody>) => void api.putFile(d.id, { body: { ...b, ...change } }).then(() => store.loadRoot("home"), toastError);
  const offered: [string, string, IconName][] = [...CORE_TABS, ...phoneTabs().filter((t) => extensionOn(t.extension)).map((t): [string, string, IconName] => [t.id, t.label, t.icon])];
  const tabs = b.tabs.filter((t) => t !== "setup");
  // Tabs of an extension the project has off stay in the choice, unseen.
  const kept = tabs.filter((t) => !offered.some(([id]) => id === t) && !CORE_TABS.some(([id]) => id === t));
  const shownTabs = tabs.filter((t) => !kept.includes(t));
  const setTabs = (t: string[]) => save({ tabs: [...t, ...kept, "setup"] });
  const move = (id: string, dir: -1 | 1) => { const i = shownTabs.indexOf(id), j = i + dir; if (j < 0 || j >= shownTabs.length) return; const n = [...shownTabs]; [n[i], n[j]] = [n[j], n[i]]; setTabs(n); };
  const others = devices.filter((x) => x.id !== d.id);
  const take = (from: FileRec) => { const fb = from.body as unknown as DeviceBody; save({ tabs: fb.tabs, layout: fb.layout ?? "viewfinder" }); toast(`“${d.name}” has the tabs and camera layout of “${from.name}” now`, { tone: "info" }); };
  const remove = async () => {
    if (!(await confirm({ danger: true, title: `Remove “${d.name}”?`, message: "It goes to the recycle bin. When the app runs on it again, it registers again with its tabs and layout as they were.", confirmLabel: "Remove" }))) return;
    try { await store.bin("home", [d.id]); } catch (e) { toastError(e); }
  };
  const rename = () => { const to = name.trim(); if (!to || to === d.name) { setName(d.name); return; } void store.rename(d, to).catch(toastError); };
  return (
    <DeviceCard icon={b.kind === "tablet" ? "tablet" : "mobile"} color={6}
      name={<TextInput size="sm" value={name} aria-label="Name" maxLength={120} onInput={(e) => setName(e.currentTarget.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />}
      sub={`${b.kind === "tablet" ? "Tablet" : "Phone"} · ${b.make} ${b.model} · app ${b.app || "?"}`}
      connection={<ConnectionMark tone={connected ? "ok" : "off"} label={connected ? "Connected" : "Registered"} />}
      actions={<DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "readout", label: "Read out again", icon: "refresh", disabled: !connected }, { separator: true }, { id: "remove", label: "Remove…", icon: "trash", danger: true }]}
        onSelect={(x) => (x === "readout" ? sendLink({ ch: "link", type: "readout" }) : void remove())} />}>
      <div className="dev-part">
        <h4>What it reported</h4>
        <p className="dev-fact">Screen {b.screen ? `${b.screen.portrait.w} × ${b.screen.portrait.h}` : "unknown"}{b.camera ? ` · camera area ${b.camera.portrait.w} × ${b.camera.portrait.h}` : ""}</p>
        <p className="dev-fact">{b.lenses.length ? b.lenses.map((l) => `${l.name}${l.focal35 ? ` (${l.focal35} mm)` : " (no focal length)"}`).join(", ") : "No lenses reported yet"}</p>
      </div>
      <div className="dev-part">
        <h4>Tabs</h4>
        <ul className="dev-tabs">
          {shownTabs.map((t, i) => { const a = offered.find(([id]) => id === t); return (
            <li key={t}><Checkbox checked onChange={() => setTabs(shownTabs.filter((x) => x !== t))}>{a?.[1] ?? t}</Checkbox><span style={{ flex: 1 }} />
              <Button size="sm" variant="quiet" icon="arrow-up" label="Earlier" disabled={i === 0} onClick={() => move(t, -1)} /><Button size="sm" variant="quiet" icon="arrow-down" label="Later" disabled={i === shownTabs.length - 1} onClick={() => move(t, 1)} /></li>
          ); })}
          {offered.filter(([id]) => !shownTabs.includes(id)).map(([id, label]) => <li key={id} className="is-off"><Checkbox checked={false} onChange={() => setTabs([...shownTabs, id])}>{label}</Checkbox></li>)}
          <li className="is-fixed"><Icon name="settings" size={14} />Setup, always last</li>
        </ul>
      </div>
      <div className="dev-part">
        <h4>Camera layout</h4>
        <Select size="sm" value={b.layout ?? "viewfinder"} onChange={(v) => save({ layout: v })} options={[{ value: "camera", label: "Camera (built in)" }, { value: "viewfinder", label: "Viewfinder (built in)" }, ...layouts.map((l) => ({ value: l.id, label: l.name }))]} />
        {others.length > 0 && (
          <div className="dev-take">
            <h4>Take the setup of another device</h4>
            <DropdownMenu size="sm" variant="secondary" icon="copy" label="Its tabs and layout from…" items={others.map((o) => ({ id: o.id, label: o.name }))} onSelect={(id) => take(others.find((o) => o.id === id)!)} />
          </div>
        )}
      </div>
    </DeviceCard>
  );
}

