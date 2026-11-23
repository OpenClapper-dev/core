// UX workshop U6: the two extensions on the phone or tablet. Hardware and Flows are apps like any other and can be
// tabs (docs/rewrite/ux-5-phone.md). Hardware: this phone as the proxy, the devices with their state, a device's
// controls in a touch form, and the one thing only a phone can show: a video transmitter's picture. Flows: the
// project's flows, played from the phone itself.
import { useState } from "preact/hooks";
import { Banner, BottomTabs, HeaderAction, Icon, List, ListRow, PropertyList, PropertyRow, PropertySection, Screen, ScreenHeader, Segmented, Slider, Switch, cx, type IconName } from "@openclapper/design";
import { AndroidDevice } from "../../kits/AndroidFrame";
import { picture } from "../u1/pictures";
import { FlowEditor, newFlow, type Flow } from "./Flow";

const DEVS: { id: string; name: string; model: string; icon: IconName; link: string; battery?: number }[] = [
  { id: "l1", name: "MC, window", model: "Aputure MC", icon: "light-fixture", link: "Connected", battery: 72 }, { id: "l3", name: "Key", model: "NEEWER FS300B", icon: "light-fixture", link: "Connected" }, { id: "l4", name: "Fill", model: "NEEWER FS230B", icon: "light-fixture", link: "Not in range" },
  { id: "b1", name: "V-mount 1", model: "NEEWER PS099S", icon: "battery", link: "Connected", battery: 64 }, { id: "c1", name: "A cam", model: "Blackmagic Pocket 6K", icon: "video", link: "Connected", battery: 81 }, { id: "t1", name: "Video village", model: "Hollyland Mars 400S Pro", icon: "antenna", link: "Connected" },
];

export default function OnPhone({ hardware, flowsOn, flows, setFlows, theme }: { hardware: boolean; flowsOn: boolean; flows: Flow[]; setFlows: (f: Flow[]) => void; theme: string }) {
  const [device, setDevice] = useState("phone");
  const [tab, setTab] = useState("hardware");
  const [open, setOpen] = useState<string | null>(null);
  const [proxy, setProxy] = useState(true);
  const [level, setLevel] = useState(60);
  const [on, setOn] = useState(true);
  const d = DEVS.find((x) => x.id === open);
  const off = (name: string) => <Screen header={<ScreenHeader title={name} />}><div className="u5-gate"><Icon name="extension" size={24} /><h2>{name} is off in this project</h2><p>Its tab stays, and says so. Switch the extension on in the project's settings.</p></div></Screen>;
  const hardwareScreen = !hardware ? off("Hardware") : d ? (
    <Screen header={<ScreenHeader title={d.name} subtitle={`${d.model} · ${proxy ? d.link : "No proxy"}`} onBack={() => setOpen(null)} />}>
      {d.id === "t1" ? <><div className="u6-feedbig"><img src={picture(14)} alt="The transmitter's picture" /></div><Banner tone="info">Only here: the picture comes over the transmitter's own Wi-Fi, which the phone joins. The Studio shows this device's state, not its picture.</Banner></>
        : d.icon === "light-fixture" ? <PropertyList><PropertySection title="Controls" icon="sliders"><div className="u5-pad"><Switch checked={on} onChange={setOn}>Power</Switch></div><PropertyRow label="Intensity"><span className="u3-slide"><Slider min={0} max={100} value={level} onChange={setLevel} /><b className="oc-num">{level} %</b></span></PropertyRow><PropertyRow label="White"><span className="u3-slide"><Slider min={2700} max={6500} step={100} value={4300} /><b className="oc-num">4300 K</b></span></PropertyRow></PropertySection></PropertyList>
          : <PropertyList><PropertySection title="State" icon="info"><PropertyRow label="Connection" value={d.link} />{d.battery != null && <PropertyRow label="Battery" value={`${d.battery} %`} />}</PropertySection></PropertyList>}
    </Screen>
  ) : (
    <Screen header={<ScreenHeader title="Hardware" subtitle={proxy ? "This phone is the proxy" : "Not the proxy"} actions={<HeaderAction icon="refresh" label="Reconnect all" />} />}>
      <div className="u5-pad"><Switch checked={proxy} onChange={setProxy}>Act as the proxy</Switch></div>
      <p className="u5-note">While it is the proxy the phone holds the Bluetooth connections and keeps its screen on. The Studio's controls go through it.</p>
      <List>{DEVS.map((x) => <ListRow key={x.id} size="touch" icon={x.icon} chevron meta={`${x.model} · ${proxy ? x.link : "No proxy"}`} trailing={x.battery != null ? <span className="oc-num">{x.battery} %</span> : undefined} onClick={() => setOpen(x.id)}>{x.name}</ListRow>)}</List>
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
