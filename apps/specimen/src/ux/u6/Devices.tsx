// UX workshop U6: the Devices app. One registry for all hardware of an account: phones and tablets always; lights,
// batteries, cameras and video transmitters once the Hardware extension is on in the project. Each type shows what
// its model exposes: controls, state, feeds and relations to other devices. The phone holds the Bluetooth
// connections (it is the proxy); the controls live here. Specified in docs/rewrite/03-capture.md and 08-extensions.md.
import { useState } from "preact/hooks";
import {
  Badge, Banner, Button, Dialog, Dock, DropdownMenu, EmptyState, Icon, PropertyList, PropertyRow, PropertySection, Segmented, Select, Slider, Switch, TextInput, Toolbar, ToolbarSpacer, cx, useDockLayout,
  type DockPanel, type IconName,
} from "@openclapper/design";
import { ColourButton, type Colour } from "../u1/catalogue";
import { picture } from "../u1/pictures";

type Kind = "phone" | "tablet" | "light" | "battery" | "camera" | "transmitter";
type Link = "connected" | "near" | "away" | "asleep" | "self";
interface Dev { id: string; kind: Kind; brand: string; model: string; name: string; link: Link; battery?: number; mins?: number; on?: boolean; level?: number; kelvin?: number; colour?: Colour; effect?: string; poweredBy?: string; rec?: boolean; iso?: string; shutter?: string }
const KIND: Record<Kind, { label: string; plural: string; icon: IconName; core?: boolean }> = { phone: { label: "Phone", plural: "Phones and tablets", icon: "mobile", core: true }, tablet: { label: "Tablet", plural: "Phones and tablets", icon: "tablet", core: true }, light: { label: "Light", plural: "Lights", icon: "light-fixture" }, battery: { label: "Battery", plural: "Batteries", icon: "battery" }, camera: { label: "Camera", plural: "Cameras", icon: "video" }, transmitter: { label: "Video transmitter", plural: "Video transmitters", icon: "antenna" } };
const LINK: Record<Link, string> = { connected: "Connected", near: "In range, connecting", away: "Not in range", asleep: "Asleep", self: "Registered" };
/** The catalogue of supported hardware: brand, model, type. It is part of the app and grows with it. */
const CATALOGUE: [string, string, Kind][] = [["Aputure", "MC", "light"], ["NEEWER", "FS230B", "light"], ["NEEWER", "FS300B", "light"], ["NEEWER", "PS099S", "battery"], ["Blackmagic", "Pocket Cinema Camera 6K", "camera"], ["Hollyland", "Mars 400S Pro", "transmitter"]];
const START: Dev[] = [
  { id: "p1", kind: "phone", brand: "Google", model: "Pixel 9 Pro", name: "Pixel 9 Pro", link: "self" }, { id: "p2", kind: "tablet", brand: "Google", model: "Pixel Tablet", name: "Pixel Tablet", link: "self" },
  { id: "l1", kind: "light", brand: "Aputure", model: "MC", name: "MC, window", link: "connected", battery: 72, mins: 96, on: true, level: 60, kelvin: 4300, colour: "#ffb070", effect: "" },
  { id: "l2", kind: "light", brand: "Aputure", model: "MC", name: "MC, practical", link: "asleep", battery: 18, on: false, level: 30, kelvin: 3200, effect: "Fire" },
  { id: "l3", kind: "light", brand: "NEEWER", model: "FS300B", name: "Key", link: "connected", on: true, level: 85, kelvin: 5600, poweredBy: "b1" },
  { id: "l4", kind: "light", brand: "NEEWER", model: "FS230B", name: "Fill", link: "away", on: false, level: 40, kelvin: 5600, poweredBy: "socket" },
  { id: "b1", kind: "battery", brand: "NEEWER", model: "PS099S", name: "V-mount 1", link: "connected", battery: 64, mins: 52 },
  { id: "c1", kind: "camera", brand: "Blackmagic", model: "Pocket Cinema Camera 6K", name: "A cam", link: "connected", battery: 81, rec: false, iso: "800", shutter: "180°" },
  { id: "t1", kind: "transmitter", brand: "Hollyland", model: "Mars 400S Pro", name: "Video village", link: "near" },
];

export default function Devices({ hardware, say, toExtensions }: { hardware: boolean; say: (m: string) => void; toExtensions: () => void }) {
  const [devs, setDevs] = useState<Dev[]>(START);
  const [sel, setSel] = useState("l1");
  const [view, setView] = useState("glance");
  const [proxy, setProxy] = useState(true);
  const [adding, setAdding] = useState<null | "scan" | "found">(null);
  const [panels, setPanels] = useDockLayout("u6-devices", { right: { tabs: ["device"] } });
  const shown = devs.filter((d) => hardware || KIND[d.kind].core), d = shown.find((x) => x.id === sel) ?? shown[0];
  const patch = (c: Partial<Dev>) => setDevs(devs.map((x) => (x.id === d.id ? { ...x, ...c } : x)));
  const live = (x: Dev) => x.link === "connected" && proxy;
  const groups = [...new Set(shown.map((x) => KIND[x.kind].plural))];
  const level = (x: Dev) => x.battery != null && <span className={cx("u6-batt", x.battery < 10 ? "is-red" : x.battery < 25 && "is-amber")}><i style={{ width: `${x.battery}%` }} /><b className="oc-num">{x.battery} %</b></span>;
  const power = (x: Dev) => (x.poweredBy === "socket" ? "Socket" : x.poweredBy ? devs.find((b) => b.id === x.poweredBy)?.name : undefined);
  const tile = (x: Dev) => (
    <button type="button" key={x.id} className={cx("u6-tile", sel === x.id && "is-current", !KIND[x.kind].core && !live(x) && "is-off")} onClick={() => setSel(x.id)}>
      <span className="u6-tile__head"><Icon name={KIND[x.kind].icon} size={20} /><strong>{x.name}</strong>{x.kind === "light" && live(x) && <i className="u6-lamp" style={{ background: x.on ? (typeof x.colour === "string" ? x.colour : "#ffe2b8") : "transparent", opacity: x.on ? 0.35 + (x.level ?? 0) / 150 : 1 }} />}</span>
      <span className="u6-tile__meta">{x.brand} {x.model}</span>
      <span className={cx("u6-link", `is-${x.link}`)}><i />{KIND[x.kind].core ? (x.id === "p1" ? "This is the proxy" : "Registered") : proxy ? LINK[x.link] : "No proxy"}</span>
      {level(x)}{x.mins != null && live(x) && <small>{x.mins} min left</small>}
      {power(x) && <small>Runs on: {power(x)}</small>}{x.kind === "battery" && <small>Powers: {devs.find((l) => l.poweredBy === x.id)?.name ?? "nothing"}</small>}
    </button>
  );
  const off = !KIND[d.kind].core && !live(d);
  const body = (
    <>
      <header className="u3-head">
        <span className="u6-big"><Icon name={KIND[d.kind].icon} size={24} /></span>
        <TextInput value={d.name} aria-label="Name" onInput={(e) => patch({ name: (e.target as HTMLInputElement).value })} />
        <span className="u3-head__type">{KIND[d.kind].label} · {d.brand} {d.model}<span style={{ flex: 1 }} />{!KIND[d.kind].core && <Button size="sm" variant="quiet" icon={d.link === "asleep" ? "sun" : "moon"} onClick={() => patch({ link: d.link === "asleep" ? "near" : "asleep" })}>{d.link === "asleep" ? "Wake" : "Sleep"}</Button>}</span>
      </header>
      {off && <Banner tone={proxy ? "neutral" : "warning"}>{!proxy ? "No phone is acting as proxy, so nothing can be controlled or read." : d.link === "asleep" ? "Asleep: the phone makes no attempt to connect to it." : d.link === "away" ? "Not in range. It connects by itself once the phone sees it." : "In range; connecting."}</Banner>}
      <PropertyList key={d.id}>
        {d.kind === "light" && (
          <PropertySection title="Controls" icon="sliders">
            <div className="u6-pad"><Switch checked={!!d.on} disabled={off} onChange={(v) => patch({ on: v })}>Power</Switch></div>
            <PropertyRow label="Intensity"><span className="u3-slide"><Slider min={0} max={100} value={d.level ?? 0} disabled={off} onChange={(v) => patch({ level: v })} /><b className="oc-num">{d.level} %</b></span></PropertyRow>
            <PropertyRow label="White"><span className="u3-slide"><Slider min={d.model === "MC" ? 3200 : 2700} max={6500} step={100} value={d.kelvin ?? 5600} disabled={off} onChange={(v) => patch({ kelvin: v, colour: undefined })} /><b className="oc-num">{d.kelvin} K</b></span></PropertyRow>
            {d.model === "MC" && <PropertyRow label="Colour"><ColourButton value={d.colour ?? "#ffffff"} label="Light colour" onChange={(c) => patch({ colour: c })} /></PropertyRow>}
            {d.model === "MC" && <PropertyRow label="Effect"><Select size="sm" value={d.effect ?? ""} onChange={(v) => patch({ effect: v })} options={[{ value: "", label: "None" }, ...["Fire", "Lightning", "TV", "Pulsing", "Paparazzi", "Party", "Cop car", "Faulty bulb", "Explosion"].map((x) => ({ value: x, label: x }))]} /></PropertyRow>}
          </PropertySection>
        )}
        {d.kind === "camera" && (
          <PropertySection title="Controls" icon="sliders">
            <div className="u6-pad"><Button variant={d.rec ? "danger" : "secondary"} icon="record" disabled={off} onClick={() => patch({ rec: !d.rec })}>{d.rec ? "Stop recording" : "Record"}</Button></div>
            <PropertyRow label="ISO"><Select size="sm" value={d.iso ?? "800"} onChange={(v) => patch({ iso: v })} options={["100", "400", "800", "1250", "3200"].map((x) => ({ value: x, label: x }))} /></PropertyRow>
            <PropertyRow label="Shutter"><Select size="sm" value={d.shutter ?? "180°"} onChange={(v) => patch({ shutter: v })} options={["90°", "172.8°", "180°", "270°"].map((x) => ({ value: x, label: x }))} /></PropertyRow>
          </PropertySection>
        )}
        {d.kind === "transmitter" && <PropertySection title="Feed" icon="video"><div className="u6-feed">{live(d) || d.link === "near" ? <img src={picture(14)} alt="The transmitter's picture" /> : <span>No picture</span>}<small>The live picture goes from the transmitter to the phone directly; the Studio sees it through the phone.</small></div></PropertySection>}
        {!KIND[d.kind].core && (
          <PropertySection title="State" icon="info">
            <PropertyRow label="Connection" value={proxy ? LINK[d.link] : "No proxy"} />
            {d.battery != null && <PropertyRow label={d.kind === "battery" ? "Charge" : "Own battery"}>{level(d)}</PropertyRow>}
            {d.mins != null && <PropertyRow label="Time left" value={`${d.mins} min`} />}
            {d.kind === "battery" && <><PropertyRow label="Output" value="14.6 V · 5.2 A · 76 W" /></>}
            {d.kind === "camera" && <><PropertyRow label="Timecode" value={d.rec ? "01:04:12:08, running" : "01:04:12:08"} /><PropertyRow label="Card" value="212 GB free" /></>}
          </PropertySection>
        )}
        {(d.kind === "light" && d.model !== "MC") || d.kind === "battery" ? (
          <PropertySection title="Relations" icon="link">
            {d.kind === "light" ? <PropertyRow label="Runs on"><Select size="sm" value={d.poweredBy ?? "socket"} onChange={(v) => setDevs(devs.map((x) => (x.id === d.id ? { ...x, poweredBy: v } : v !== "socket" && x.poweredBy === v ? { ...x, poweredBy: "socket" } : x)))} options={[{ value: "socket", label: "A socket" }, ...devs.filter((x) => x.kind === "battery").map((x) => ({ value: x.id, label: x.name }))]} /></PropertyRow> : <PropertyRow label="Powers" value={devs.find((l) => l.poweredBy === d.id)?.name ?? "Nothing"} />}
            <p className="u6-note">A battery powers one light at a time. The light cannot report this itself, so it is said here.</p>
          </PropertySection>
        ) : null}
        {KIND[d.kind].core && (
          <>
            <PropertySection title="Reported by the device" icon="mobile"><PropertyRow label="Screen" value={d.kind === "phone" ? "412 × 915 upright, 915 × 412 landscape" : "800 × 1280 upright"} /><PropertyRow label="Real lenses" value={d.kind === "phone" ? "0.5× (13 mm), 1× (24 mm), 5× (120 mm), Macro (no report)" : "1× (26 mm)"} /><PropertyRow label="Last seen" value={d.id === "p1" ? "Now" : "Yesterday 18:20"} /></PropertySection>
            <PropertySection title="On this device" icon="apps"><PropertyRow label="Tabs" value={d.kind === "phone" ? "Camera, Media, Shots, Setup" : "Canvas, Media, Shots, Setup"} /><PropertyRow label="Camera layout" value={d.kind === "phone" ? "Scout, wide" : "Camera"} /></PropertySection>
            <p className="u6-note">Phones and tablets register themselves and keep this current. One record per piece of hardware; it belongs to your account and follows you into every project.</p>
          </>
        )}
        <div className="u6-pad"><Button size="sm" variant="quiet" icon="trash" onClick={() => { setDevs(devs.filter((x) => x.id !== d.id)); say(`“${d.name}” removed. Photos taken with it keep their own readout`); }}>Remove the device</Button></div>
      </PropertyList>
    </>
  );
  const dockPanels: DockPanel[] = [{ id: "device", title: d ? d.name : "Device", icon: d ? KIND[d.kind].icon : "mobile", body: d ? body : <EmptyState icon="mobile" title="No device" /> }];
  return (
    <div className="oc-app u3-win">
      <Toolbar>
        <Icon name="mobile" size={20} /><strong className="u3-title">Devices</strong><Badge>{shown.length}</Badge>
        <Segmented label="View" value={view} onChange={setView} options={[{ value: "glance", label: "At a glance", icon: "grid" }, { value: "list", label: "By type", icon: "list" }]} />
        <ToolbarSpacer />
        {hardware && <button type="button" className={cx("u6-pill", proxy ? "is-preview" : "is-none")} title="The phone that holds the Bluetooth connections. Click to switch it on and off" onClick={() => setProxy(!proxy)}><i />{proxy ? "Pixel 9 Pro is the proxy" : "No proxy: open Proxy on a phone"}</button>}
        {hardware && <Button size="sm" variant="quiet" icon="refresh" disabled={!proxy} onClick={() => say("Every connection is dropped and built up again, one device after another")}>Reconnect all</Button>}
        {hardware && <Button size="sm" variant="primary" icon="plus" disabled={!proxy} onClick={() => { setAdding("scan"); setTimeout(() => setAdding((a) => (a ? "found" : a)), 1400); }}>Add a device</Button>}
        <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "ext", label: "Extensions of this project…", icon: "extension" }]} onSelect={toExtensions} />
      </Toolbar>
      <Dock panels={dockPanels} layout={panels} onLayoutChange={setPanels} zoneSizes={{ right: 360 }}>
        <div className="u6-main">
          {!hardware && <Banner tone="info" action={<Button size="sm" onClick={toExtensions}>Extensions</Button>}>The Hardware extension adds lights, batteries, cameras and video transmitters to this list. It is off in this project.</Banner>}
          {groups.map((g) => <section key={g}><h3 className="u6-group">{g}</h3>
            {view === "glance" ? <div className="u6-tiles">{shown.filter((x) => KIND[x.kind].plural === g).map(tile)}</div>
              : <ul className="u6-rows">{shown.filter((x) => KIND[x.kind].plural === g).map((x) => <li key={x.id} className={cx(sel === x.id && "is-current")} onClick={() => setSel(x.id)}><Icon name={KIND[x.kind].icon} /><strong>{x.name}</strong><span>{x.brand} {x.model}</span><span className={cx("u6-link", `is-${x.link}`)}><i />{KIND[x.kind].core ? "Registered" : proxy ? LINK[x.link] : "No proxy"}</span>{level(x) || <span />}</li>)}</ul>}
          </section>)}
        </div>
      </Dock>
      {adding && (
        <Dialog fixed title="Add a device" onClose={() => setAdding(null)} footer={<><span className="u3-hint">The phone scans; the Studio shows what it finds.</span><span style={{ flex: 1 }} /><Button onClick={() => setAdding(null)}>Close</Button></>}>
          <div className="u6-add">
            <div><h3 className="u6-group">{adding === "scan" ? "Scanning through the Pixel 9 Pro…" : "Found nearby"}</h3>
              {adding === "found" ? <ul className="u6-rows">{[["NEEWER FS300B", "Probably a NEEWER FS300B"], ["AP-MC-7F21", "Probably an Aputure MC"]].map(([n, guess]) => <li key={n} onClick={() => { const id = `n${Date.now()}`, mc = n.startsWith("AP"); setDevs([...devs, { id, kind: "light", brand: mc ? "Aputure" : "NEEWER", model: mc ? "MC" : "FS300B", name: mc ? "MC 3" : "FS300B 2", link: "near", on: false, level: 50, kelvin: 5600, battery: mc ? 90 : undefined, poweredBy: mc ? undefined : "socket" }]); setSel(id); setAdding(null); say("Paired. Name it in its panel"); }}><Icon name="bluetooth" /><strong>{n}</strong><span>{guess}</span><Button size="sm">Pair</Button></li>)}</ul> : <p className="u6-note">Hold the device near the phone and switch it on.</p>}
            </div>
            <div><h3 className="u6-group">Supported hardware</h3><ul className="u6-rows u6-rows--cat">{CATALOGUE.map(([b, m, k]) => <li key={m}><Icon name={KIND[k].icon} /><strong>{b}</strong><span>{m}</span><span>{KIND[k].label}</span></li>)}</ul></div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
