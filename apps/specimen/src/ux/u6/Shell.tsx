// UX workshop U6, round 1: devices, camera layouts and extensions. Four places behind the prototype bar: the camera
// layout editor, the Devices app, the Flows app, and the project's extensions, which decide what the other three
// show. A prototype on fake data: no phone, no Bluetooth, no server, no product code.
// Specified in docs/rewrite/03-capture.md and 08-extensions.md.
import "../u3/u3.css";
import "../u5/u5.css";
import "./u6.css";
import { useEffect, useState } from "preact/hooks";
import { AppIcon, Banner, Button, EmptyState, Icon, List, ListRow, PropertyList, PropertyRow, PropertySection, Select, Slider, StatusBar, Switch, Toast, Toolbar, ToolbarSpacer, TrackLayout, cx, type IconName } from "@openclapper/design";
import Devices from "./Devices";
import Layouts from "./Layouts";
import OnPhone from "./OnPhone";

type Place = "layouts" | "devices" | "flows" | "phone" | "extensions";
const PLACES: { id: Place; label: string; icon: IconName; color: number }[] = [{ id: "layouts", label: "Camera layouts", icon: "camera-layout", color: 4 }, { id: "devices", label: "Devices", icon: "mobile", color: 6 }, { id: "flows", label: "Flows", icon: "route", color: 8 }, { id: "phone", label: "On the phone", icon: "mobile", color: 3 }, { id: "extensions", label: "Project · Extensions", icon: "extension", color: 0 }];

/** A flow: a timed programme that drives controls of devices. Each lane is one control of one device. */
const LANES = [
  { id: "mc-i", label: "MC, window · intensity", color: 3, items: [{ id: "a", start: 0, end: 4, label: "0 → 60 %" }, { id: "b", start: 4, end: 14, label: "hold 60 %" }, { id: "c", start: 14, end: 18, label: "60 → 0 %" }] },
  { id: "mc-c", label: "MC, window · colour", color: 2, items: [{ id: "d", start: 0, end: 9, label: "3200 K" }, { id: "e", start: 9, end: 12, label: "→ 5600 K" }] },
  { id: "key", label: "Key · intensity", color: 6, items: [{ id: "f", start: 6, end: 8, label: "0 → 85 %" }, { id: "g", start: 8, end: 20, label: "hold 85 %" }] },
  { id: "cam", label: "A cam · record", color: 1, items: [{ id: "h", start: 2, end: 19, label: "recording" }] },
];
function Flows({ say }: { say: (m: string) => void }) {
  const [flow, setFlow] = useState("f1");
  const [sel, setSel] = useState("a");
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [from, setFrom] = useState("studio");
  useEffect(() => { if (!playing) return; const t0 = performance.now() - t * 1000; let raf = 0; const tick = () => { const now = (performance.now() - t0) / 1000; if (now >= 20) { setPlaying(false); setT(0); } else { setT(now); raf = requestAnimationFrame(tick); } }; raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf); }, [playing]);
  const item = LANES.flatMap((l) => l.items.map((i) => ({ ...i, lane: l.label }))).find((i) => i.id === sel);
  return (
    <div className="oc-app u3-win">
      <Toolbar>
        <Icon name="route" size={20} /><strong className="u3-title">{flow === "f1" ? "Sunrise through the window" : "Lightning"}</strong>
        <Button size="sm" variant="primary" icon={playing ? "pause" : "play"} onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</Button>
        <span className="oc-num u6-saved">{t.toFixed(1)} s / 20 s</span>
        <ToolbarSpacer />
        <Select size="sm" value={from} onChange={setFrom} options={[{ value: "studio", label: "Plays from the Studio, through the proxy" }, { value: "phone", label: "Plays on the phone itself" }]} />
      </Toolbar>
      <div className="u6-flows">
        <aside className="u6-flows__list"><List>{[["f1", "Sunrise through the window", "20 s · 3 devices"], ["f2", "Lightning", "4 s · 1 device"]].map(([id, n, m]) => <ListRow key={id} size="lg" icon="route" selected={flow === id} meta={m} onClick={() => setFlow(id)}>{n}</ListRow>)}</List><p className="u6-note">A flow is a file of the project. It can drive any control a device exposes: a light's intensity, a camera's recording.</p></aside>
        <TrackLayout className="u6-flows__tracks" lanes={LANES} duration={20} scale={44} tick={2} playhead={t} onSeek={(x) => { setPlaying(false); setT(x); }} selected={sel} onSelect={setSel} />
        <aside className="u6-flows__side">{item ? <PropertyList><PropertySection title="Step" icon="timeline"><PropertyRow label="Control" value={item.lane} /><PropertyRow label="Does" value={item.label} /><PropertyRow label="From" value={`${item.start} s`} numeric /><PropertyRow label="Lasts" value={`${item.end - item.start} s`} numeric /><PropertyRow label="Curve"><Select size="sm" value="linear" options={[{ value: "linear", label: "Linear" }, { value: "ease", label: "Ease in and out" }]} /></PropertyRow><PropertyRow label="Value"><span className="u3-slide"><Slider min={0} max={100} value={60} /><b className="oc-num">60 %</b></span></PropertyRow></PropertySection><div className="u6-pad"><Button size="sm" variant="quiet" icon="trash" onClick={() => say("Removes the step")}>Remove the step</Button></div></PropertyList> : <EmptyState icon="timeline" title="No step chosen" />}</aside>
      </div>
      <StatusBar>4 controls of 3 devices · needs the Hardware extension · a flow has no clock in common with a shot's progression</StatusBar>
    </div>
  );
}

export default function U6Shell() {
  const [place, setPlace] = useState<Place>("layouts");
  const [ext, setExt] = useState({ hardware: true, flows: true });
  const [theme, setTheme] = useState("dark");
  const [toast, setToast] = useState<string | null>(null);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast((x) => (x === m ? null : x)), 3000); };
  const EXT: { id: "hardware" | "flows"; label: string; icon: IconName; what: string; brings: [string, string][] }[] = [
    { id: "hardware", label: "Hardware", icon: "antenna", what: "Lights, batteries, cameras and video transmitters from the supported catalogue: pairing, control from the Studio through the phone, live picture.", brings: [["Device types", "Light, battery, camera, video transmitter"], ["Apps", "More in Devices; Proxy on the phone"], ["Camera controls", "Lights, for a camera layout"], ["Phone link", "A channel of its own"]] },
    { id: "flows", label: "Flows", icon: "route", what: "Timed programmes that drive the controls of devices. Needs Hardware.", brings: [["File type", "Flow"], ["Apps", "Flows, in the Studio and on the phone"]] },
  ];
  const extensions = (
    <div className="oc-app u3-win">
      <Toolbar><Icon name="extension" size={20} /><strong className="u3-title">Nachtzug · Extensions</strong></Toolbar>
      <div className="u6-exts">
        <p className="u6-lead">Extensions are switched on per project. Everyone in the project then sees their apps, file types and controls. Switching one off deletes nothing: its files and devices stay and show as needing the extension.</p>
        {EXT.map((e) => (
          <section key={e.id} className={cx("u6-ext", !ext[e.id] && "is-off")}>
            <AppIcon glyph={e.icon} color={e.id === "hardware" ? 2 : 8} size={48} off={!ext[e.id]} />
            <div><h3>{e.label}</h3><p>{e.what}</p><dl>{e.brings.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
            <Switch checked={ext[e.id]} disabled={e.id === "flows" && !ext.hardware} aria-label={`${e.label} in this project`} onChange={(c) => { setExt(e.id === "hardware" && !c ? { hardware: false, flows: false } : { ...ext, [e.id]: c }); say(c ? `${e.label} is on for this project` : e.id === "hardware" && ext.flows ? "Hardware is off, and Flows with it. Nothing was deleted" : `${e.label} is off. Nothing was deleted`); }} />
          </section>
        ))}
        <Banner tone="info">Try it: switch Hardware off, then look at Devices (only phones and tablets), Camera layouts (the Lights control is unavailable) and Flows.</Banner>
      </div>
    </div>
  );
  return (
    <div className="u3 u6" data-theme={theme}>
      <header className="u3-proto">
        <strong>U6</strong><span className="u3-proto__note">prototype</span>
        <span className="u3-proto__files" role="tablist" aria-label="Place">
          {PLACES.map((p) => <button type="button" key={p.id} role="tab" aria-selected={place === p.id} className={cx(place === p.id && "is-on")} onClick={() => setPlace(p.id)}><AppIcon glyph={p.icon} color={p.color} size={20} off={p.id === "flows" && !ext.flows} />{p.label}</button>)}
        </span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="quiet" icon={theme === "light" ? "moon" : "sun"} label="Switch theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")} />
      </header>
      {place === "layouts" ? <Layouts hardware={ext.hardware} say={say} /> : place === "devices" ? <Devices hardware={ext.hardware} say={say} toExtensions={() => setPlace("extensions")} /> : place === "phone" ? <OnPhone hardware={ext.hardware} flows={ext.flows} theme={theme} /> : place === "extensions" ? extensions
        : ext.flows ? <Flows say={say} /> : <div className="oc-app u3-win"><EmptyState icon="route" title="Flows needs its extension" action={<Button onClick={() => setPlace("extensions")}>Extensions of this project</Button>}>The Flows extension is off in this project. Its files stay and show as “needs the Flows extension”.</EmptyState></div>}
      {toast && <Toast className="u3-toast" tone="info" onDismiss={() => setToast(null)}>{toast}</Toast>}
    </div>
  );
}
