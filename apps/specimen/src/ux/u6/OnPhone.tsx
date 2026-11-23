// UX workshop U6: the two extensions on the phone or tablet. Hardware and Flows are apps like any other and can be
// tabs (docs/rewrite/ux-5-phone.md). Hardware: this phone as the proxy, the devices with their state, a device's
// controls in a touch form, and the one thing only a phone can show: a video transmitter's picture. Flows: the
// project's flows, played from the phone itself.
import { useEffect, useState } from "preact/hooks";
import { ActionBar, Banner, BottomTabs, HeaderAction, Icon, List, ListRow, PropertyList, PropertyRow, PropertySection, Screen, ScreenHeader, Slider, Switch, TouchButton, cx, type IconName } from "@openclapper/design";
import { AndroidDevice } from "../../kits/AndroidFrame";
import { picture } from "../u1/pictures";

const DEVS: { id: string; name: string; model: string; icon: IconName; link: string; battery?: number }[] = [
  { id: "l1", name: "MC, window", model: "Aputure MC", icon: "light-fixture", link: "Connected", battery: 72 }, { id: "l3", name: "Key", model: "NEEWER FS300B", icon: "light-fixture", link: "Connected" }, { id: "l4", name: "Fill", model: "NEEWER FS230B", icon: "light-fixture", link: "Not in range" },
  { id: "b1", name: "V-mount 1", model: "NEEWER PS099S", icon: "battery", link: "Connected", battery: 64 }, { id: "c1", name: "A cam", model: "Blackmagic Pocket 6K", icon: "video", link: "Connected", battery: 81 }, { id: "t1", name: "Video village", model: "Hollyland Mars 400S Pro", icon: "antenna", link: "Connected" },
];
const LANES: [string, number, [number, number][]][] = [["MC, window · intensity", 3, [[0, 18]]], ["MC, window · colour", 2, [[0, 12]]], ["Key · intensity", 6, [[6, 20]]], ["A cam · record", 1, [[2, 19]]]];

export default function OnPhone({ hardware, flows, theme }: { hardware: boolean; flows: boolean; theme: string }) {
  const [tab, setTab] = useState("hardware");
  const [open, setOpen] = useState<string | null>(null);
  const [proxy, setProxy] = useState(true);
  const [level, setLevel] = useState(60);
  const [on, setOn] = useState(true);
  const [t, setT] = useState<number | null>(null);
  useEffect(() => { if (t == null) return; const t0 = performance.now() - t * 1000; let raf = 0; const tick = () => { const now = (performance.now() - t0) / 1000; if (now >= 20) setT(null); else { setT(now); raf = requestAnimationFrame(tick); } }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, [t != null]);
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
  const flowsScreen = !flows ? off("Flows") : open === "f1" ? (
    <Screen header={<ScreenHeader title="Sunrise through the window" subtitle="20 s · 4 controls of 3 devices" onBack={() => { setOpen(null); setT(null); }} />} footer={<ActionBar><TouchButton variant="primary" block icon={t != null ? "stop" : "play"} onClick={() => setT(t != null ? null : 0)}>{t != null ? `Stop · ${t.toFixed(1)} s` : "Play on this phone"}</TouchButton></ActionBar>}>
      <div className="u6-lanes u6-prog">{LANES.map(([label, color, segs]) => <div key={label}>{segs.map(([a, b]) => <i key={a} style={{ left: `${a * 5}%`, width: `${(b - a) * 5}%`, background: `var(--cat-${color})` }} />)}<span>{label}</span></div>)}{t != null && <b style={{ left: `calc(${t * 5}% )` }} />}</div>
      <p className="u5-note">A flow is made in the Studio. The phone plays it by itself, so it also runs without a connection to the server.</p>
    </Screen>
  ) : (
    <Screen header={<ScreenHeader title="Flows" subtitle="Nachtzug" />}>
      <List>{[["f1", "Sunrise through the window", "20 s · 3 devices"], ["f2", "Lightning", "4 s · 1 device"]].map(([id, n, m]) => <ListRow key={id} size="touch" icon="route" chevron meta={m} onClick={() => setOpen(id)}>{n}</ListRow>)}</List>
    </Screen>
  );
  return (
    <div className="u6-phone">
      <AndroidDevice width={416} height={860} dark={theme === "dark"}><div className={cx("u5-fill")}><div className="u5-app">{tab === "hardware" ? hardwareScreen : flowsScreen}</div><BottomTabs value={tab} onChange={(v) => { setTab(v); setOpen(null); setT(null); }} tabs={[{ id: "hardware", label: "Hardware", icon: "light-fixture" }, { id: "flows", label: "Flows", icon: "route" }]} /></div></AndroidDevice>
      <div className="u6-phone__notes">
        <h3>Extensions on the phone and tablet</h3>
        <p>Hardware and Flows are apps like Media or Shots. With the extension on in the project they can be chosen as tabs on a device (Setup, or the device's entry in the Studio's Devices).</p>
        <p><strong>Hardware:</strong> the switch that makes this phone the proxy, the devices with their state, and a touch form for a device's controls. A video transmitter's picture shows here and only here.</p>
        <p><strong>Flows:</strong> the project's flows, to play from the phone itself. They are made in the Studio.</p>
        <p>Only the two extension tabs are drawn here; the rest of the app is in U5.</p>
      </div>
    </div>
  );
}
