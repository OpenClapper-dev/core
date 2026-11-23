// UX workshop U6: the two extensions on the phone or tablet. Hardware and Flows are apps like any other and can be
// tabs (docs/rewrite/ux-5-phone.md). Hardware: this phone as the proxy, the devices with their state, a device's
// controls in a touch form, and the one thing only a phone can show: a video transmitter's picture. Flows: the
// project's flows, played from the phone itself.
import { useState } from "preact/hooks";
import { Badge, Banner, BottomTabs, HeaderAction, Icon, List, ListRow, Screen, ScreenHeader, Segmented, Slider, Switch, TouchButton, cx, type IconName } from "@openclapper/design";
import { AndroidDevice } from "../../kits/AndroidFrame";
import { picture } from "../u1/pictures";
import { FlowEditor, newFlow, type Flow } from "./Flow";

interface PDev { id: string; name: string; model: string; type: string; tint: number; icon: IconName; link: "connected" | "near" | "away"; battery?: number; on?: boolean; level?: number; kelvin?: number; rec?: boolean }
const START: PDev[] = [
  { id: "l1", name: "MC, window", model: "Aputure MC", type: "Light", tint: 3, icon: "light-fixture", link: "connected", battery: 72, on: true, level: 60, kelvin: 4300 }, { id: "l3", name: "Key", model: "NEEWER FS300B", type: "Light", tint: 3, icon: "light-fixture", link: "connected", on: true, level: 85, kelvin: 5600 }, { id: "l4", name: "Fill", model: "NEEWER FS230B", type: "Light", tint: 3, icon: "light-fixture", link: "away", on: false, level: 40, kelvin: 5600 },
  { id: "b1", name: "V-mount 1", model: "NEEWER PS099S", type: "Battery", tint: 4, icon: "battery", link: "connected", battery: 18 }, { id: "c1", name: "A cam", model: "Blackmagic Pocket 6K", type: "Camera", tint: 1, icon: "video", link: "connected", battery: 81, rec: false }, { id: "t1", name: "Video village", model: "Hollyland Mars 400S Pro", type: "Transmitter", tint: 8, icon: "antenna", link: "near" },
];

export default function OnPhone({ hardware, flowsOn, flows, setFlows, theme }: { hardware: boolean; flowsOn: boolean; flows: Flow[]; setFlows: (f: Flow[]) => void; theme: string }) {
  const [device, setDevice] = useState("phone");
  const [tab, setTab] = useState("hardware");
  const [open, setOpen] = useState<string | null>(null);
  const [proxy, setProxy] = useState(true);
  const [devs, setDevs] = useState<PDev[]>(START);
  const [view, setView] = useState("table");
  const d = devs.find((x) => x.id === open);
  const set = (id: string, c: Partial<PDev>) => setDevs((all) => all.map((x) => (x.id === id ? { ...x, ...c } : x)));
  const live = (x: PDev) => proxy && x.link === "connected";
  /** The connection in colour: green connected, amber on its way, red out of reach or no proxy. */
  const link = (x: PDev) => (!proxy ? <Badge tone="danger" icon="warning">No proxy</Badge> : x.link === "connected" ? <Badge tone="success" icon="check">Connected</Badge> : x.link === "near" ? <Badge tone="warning" icon="loader">Connecting</Badge> : <Badge tone="danger" icon="wifi-off">Not in range</Badge>);
  const batt = (x: PDev) => (x.battery != null ? <span className={cx("u6-batt", x.battery < 10 ? "is-red" : x.battery < 25 && "is-amber")}><i style={{ width: `${x.battery}%` }} /><b className="oc-num">{x.battery} %</b></span> : <span className="u6-dash">–</span>);
  const kind = (x: PDev) => <span className="u6-kind" style={{ "--c": `var(--cat-${x.tint})` }}><Icon name={x.icon} size={12} />{x.type}</span>;
  /** What a device exposes, ready to use: in its card and on its own screen. */
  const controls = (x: PDev) => (x.id === "t1" ? <div className="u6-feedbig">{proxy ? <img src={picture(14)} alt="The transmitter's picture" /> : <span className="u6-dash">No picture without the proxy</span>}</div>
    : x.type === "Light" ? <>
      <label className="u6-pfield"><span>Power</span><Switch checked={!!x.on} disabled={!live(x)} onChange={(v) => set(x.id, { on: v })} aria-label={`Power of ${x.name}`} /></label>
      <label className="u6-pfield"><span>Intensity <b className="oc-num">{x.level} %</b></span><Slider min={0} max={100} value={x.level ?? 0} disabled={!live(x)} onChange={(v) => set(x.id, { level: v })} /></label>
      <label className="u6-pfield"><span>White <b className="oc-num">{x.kelvin} K</b></span><Slider min={2700} max={6500} step={100} value={x.kelvin ?? 5600} disabled={!live(x)} onChange={(v) => set(x.id, { kelvin: v })} /></label>
    </> : x.type === "Camera" ? <label className="u6-pfield"><span>Timecode <b className="oc-num">01:04:12:08</b></span><TouchButton variant={x.rec ? "primary" : "secondary"} icon="record" disabled={!live(x)} onClick={() => set(x.id, { rec: !x.rec })}>{x.rec ? "Stop recording" : "Record"}</TouchButton></label>
      : <span className="u6-pfield"><span>Output <b className="oc-num">14.6 V · 5.2 A · 76 W</b></span><span>Powers <b>Key</b></span></span>);
  const off = (name: string) => <Screen header={<ScreenHeader title={name} />}><div className="u5-gate"><Icon name="extension" size={24} /><h2>{name} is off in this project</h2><p>Its tab stays, and says so. Switch the extension on in the project's settings.</p></div></Screen>;
  const hardwareScreen = !hardware ? off("Hardware") : d ? (
    <Screen header={<ScreenHeader title={d.name} subtitle={d.model} onBack={() => setOpen(null)} />}>
      <div className="u6-pcard u6-pcard--alone" style={{ "--c": `var(--cat-${d.tint})` }}><div className="u6-pcard__head">{kind(d)}{link(d)}{d.battery != null && batt(d)}</div>{controls(d)}</div>
      {d.id === "t1" && <Banner tone="info">Only here: the picture comes over the transmitter's own Wi-Fi, which the phone joins. The Studio shows this device's state, not its picture.</Banner>}
    </Screen>
  ) : (
    <Screen header={<ScreenHeader title="Hardware" subtitle={proxy ? "This phone is the proxy" : "Not the proxy"} actions={<HeaderAction icon="refresh" label="Reconnect all" />} />}>
      <div className="u5-pad u6-phead"><Switch checked={proxy} onChange={setProxy}>Act as the proxy</Switch><Segmented label="View" value={view} onChange={setView} options={[{ value: "table", label: "Table", icon: "list" }, { value: "cards", label: "Cards", icon: "rows" }]} /></div>
      {view === "table" ? (
        <table className="u6-ptable">
          <thead><tr><th>Device</th><th>Type</th><th>Connection</th><th>Battery</th></tr></thead>
          <tbody>{devs.map((x) => <tr key={x.id} onClick={() => setOpen(x.id)}><td><strong>{x.name}</strong><small>{x.model}</small></td><td>{kind(x)}</td><td>{link(x)}</td><td>{batt(x)}</td></tr>)}</tbody>
        </table>
      ) : <div className="u6-pcards">{devs.map((x) => <article key={x.id} className={cx("u6-pcard", !live(x) && "is-off")} style={{ "--c": `var(--cat-${x.tint})` }}><header><Icon name={x.icon} size={20} /><span><strong>{x.name}</strong><small>{x.model}</small></span><HeaderAction icon="chevron-right" label={`Open ${x.name}`} onClick={() => setOpen(x.id)} /></header><div className="u6-pcard__head">{link(x)}{x.battery != null && batt(x)}</div>{controls(x)}</article>)}</div>}
      <p className="u5-note">While it is the proxy the phone holds the Bluetooth connections and keeps its screen on. The Studio's controls go through it.</p>
    </Screen>
  );
  const flow = flows.find((f) => f.id === open);
  const flowsScreen = !flowsOn ? off("Flows") : flow ? (
    <Screen scroll={false} header={<ScreenHeader title={flow.name} subtitle={`${flow.length} s · ${flow.tracks.length} tracks`} onBack={() => setOpen(null)} />}>
      <FlowEditor key={flow.id} touch flow={flow} onChange={(f) => setFlows(flows.map((x) => (x.id === f.id ? f : x)))} />
    </Screen>
  ) : (
    <Screen header={<ScreenHeader title="Flows" subtitle="Nachtzug" actions={<HeaderAction icon="plus" label="New flow" onClick={() => { const f = newFlow(flows.length + 1); setFlows([...flows, f]); setOpen(f.id); }} />} />}>
      <List>{flows.map((f) => <ListRow key={f.id} size="touch" icon="route" chevron meta={`${f.length} s · ${f.tracks.length} tracks`} onClick={() => setOpen(f.id)}>{f.name}</ListRow>)}</List>
      <p className="u5-note">Flows are made, changed and played here as in the Studio: the same editor, and the same flows.</p>
    </Screen>
  );
  return (
    <div className="u6-phone">
      <AndroidDevice width={device === "tablet" ? 1040 : 416} height={device === "tablet" ? 780 : 860} dark={theme === "dark"}><div className={cx("u5-fill")}><div className="u5-app">{tab === "hardware" ? hardwareScreen : flowsScreen}</div><BottomTabs value={tab} onChange={(v) => { setTab(v); setOpen(null); }} tabs={[{ id: "hardware", label: "Hardware", icon: "light-fixture" }, { id: "flows", label: "Flows", icon: "route" }]} /></div></AndroidDevice>
      <div className="u6-phone__notes">
        <h3>Extensions on the phone and tablet</h3>
        <p>Hardware and Flows are apps like Media or Shots. With the extension on in the project they can be chosen as tabs on a device (Setup, or the device's entry in the Studio's Devices).</p>
        <p><strong>Hardware:</strong> the switch that makes this phone the proxy, the devices with their state, and a touch form for a device's controls. A video transmitter's picture shows here and only here.</p>
        <p><strong>Flows:</strong> the same editor as in the Studio, in a touch form: make a flow, add tracks and keyframes, set values, play it from the device itself. What is changed here shows in the Studio's Flows and the other way round.</p>
        <Segmented label="Device" value={device} onChange={setDevice} options={[{ value: "phone", label: "Phone" }, { value: "tablet", label: "Tablet" }]} />
        <p>Only the two extension tabs are drawn here; the rest of the app is in U5.</p>
      </div>
    </div>
  );
}
