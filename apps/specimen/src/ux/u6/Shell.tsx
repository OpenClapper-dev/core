// UX workshop U6, round 1: devices, camera layouts and extensions. Four places behind the prototype bar: the camera
// layout editor, the Devices app, the Flows app, and the project's extensions, which decide what the other three
// show. A prototype on fake data: no phone, no Bluetooth, no server, no product code.
// Specified in docs/rewrite/03-capture.md and 08-extensions.md.
import "../u3/u3.css";
import "../u5/u5.css";
import "./u6.css";
import { useState } from "preact/hooks";
import { AppIcon, Banner, Button, Dock, DropdownMenu, EmptyState, Icon, Slider, StatusBar, Switch, TextInput, Toast, Toolbar, ToolbarSpacer, cx, useDockLayout, type IconName } from "@openclapper/design";
import { FlowEditor, START_FLOWS, newFlow, type Flow } from "./Flow";
import Devices from "./Devices";
import Layouts from "./Layouts";
import OnPhone from "./OnPhone";

type Place = "layouts" | "devices" | "flows" | "phone" | "extensions";
const PLACES: { id: Place; label: string; icon: IconName; color: number }[] = [{ id: "layouts", label: "Camera layouts", icon: "camera-layout", color: 4 }, { id: "devices", label: "Devices", icon: "mobile", color: 6 }, { id: "flows", label: "Flows", icon: "route", color: 8 }, { id: "phone", label: "On the phone", icon: "mobile", color: 3 }, { id: "extensions", label: "Project · Extensions", icon: "extension", color: 0 }];

/** The Flows app in the Studio: the project's flows at the left, the editor beside them. */
function Flows({ flows, setFlows, say }: { flows: Flow[]; setFlows: (f: Flow[]) => void; say: (m: string) => void }) {
  const [cur, setCur] = useState(flows[0]?.id);
  const flow = flows.find((f) => f.id === cur) ?? flows[0];
  const [panels, setPanels, reset] = useDockLayout("u6-flows", { left: { tabs: ["flows"] }, right: { tabs: ["chosen"] } });
  const change = (f: Flow) => setFlows(flows.map((x) => (x.id === f.id ? f : x)));
  // The chosen flow opens in the list: what belongs to the flow itself (its name, its length) sits right under it.
  const list = (
    <>
      <ul className="u6-flowlist">
        {flows.map((f) => (
          <li key={f.id} className={cx(f.id === flow?.id && "is-on")}>
            <button type="button" className="u6-flowlist__row" aria-expanded={f.id === flow?.id} onClick={() => setCur(f.id)}><Icon name={f.id === flow?.id ? "chevron-down" : "chevron-right"} size={12} /><Icon name="route" /><span><strong>{f.name}</strong><small className="oc-num">{f.length} s · {f.tracks.length} tracks</small></span></button>
            {f.id === flow?.id && (
              <div className="u6-flowlist__props">
                <label><span>Name</span><TextInput size="sm" value={f.name} style={{ width: "100%" }} onInput={(e) => change({ ...f, name: (e.target as HTMLInputElement).value })} /></label>
                <label><span>Length <b className="oc-num">{f.length} s</b></span><Slider min={2} max={60} value={f.length} onChange={(v) => change({ ...f, length: v })} /></label>
                <span className="u3-bar"><Button size="sm" variant="quiet" icon="copy" onClick={() => { const c = { ...f, id: `f${Date.now()}`, name: `${f.name}, copy` }; setFlows([...flows, c]); setCur(c.id); }}>Duplicate</Button><Button size="sm" variant="quiet" icon="trash" disabled={flows.length < 2} onClick={() => { setFlows(flows.filter((x) => x.id !== f.id)); setCur(flows.find((x) => x.id !== f.id)!.id); }}>Delete</Button></span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="u6-note">A flow is a file of the project. It drives controls of devices over time: a light's intensity and colour, a camera's recording.</p>
    </>
  );
  return (
    <div className="oc-app u3-win">
      <Toolbar><Icon name="route" size={20} /><strong className="u3-title">{flow ? flow.name : "Flows"}</strong><ToolbarSpacer /><Button size="sm" icon="plus" onClick={() => { const f = newFlow(flows.length + 1); setFlows([...flows, f]); setCur(f.id); }}>New flow</Button><DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "panels", label: "Panels back to their places", icon: "refresh" }]} onSelect={reset} /></Toolbar>
      {/* The list of flows and what is chosen are panels like in every other app; the tracks are the middle. */}
      {flow ? <FlowEditor key={flow.id} flow={flow} onChange={change} onRun={() => say(`“${flow.name}” is saved and runs on the phone itself; the Studio follows its position`)}
        frame={(main, inspector) => <Dock layout={panels} onLayoutChange={setPanels} zoneSizes={{ left: 250, right: 300 }} panels={[{ id: "flows", title: "Flows", icon: "route", body: list }, { id: "chosen", title: "Chosen", icon: "info", body: inspector }]}>{main}</Dock>} />
        : <EmptyState icon="route" title="No flow yet" />}
      <StatusBar>{flow && <>{flow.tracks.length} tracks · {flow.tracks.reduce((a, x) => a + x.keys.length, 0)} keyframes · {flow.markers.length} markers · </>}needs the Hardware extension · the same editor runs on the phone and tablet</StatusBar>
    </div>
  );
}

export default function U6Shell() {
  const [place, setPlace] = useState<Place>("layouts");
  const [ext, setExt] = useState({ hardware: true, flows: true });
  const [theme, setTheme] = useState("dark");
  const [flows, setFlows] = useState<Flow[]>(START_FLOWS);
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
      {place === "layouts" ? <Layouts hardware={ext.hardware} say={say} /> : place === "devices" ? <Devices hardware={ext.hardware} say={say} toExtensions={() => setPlace("extensions")} /> : place === "phone" ? <OnPhone hardware={ext.hardware} flowsOn={ext.flows} flows={flows} setFlows={setFlows} theme={theme} /> : place === "extensions" ? extensions
        : ext.flows ? <Flows flows={flows} setFlows={setFlows} say={say} /> : <div className="oc-app u3-win"><EmptyState icon="route" title="Flows needs its extension" action={<Button onClick={() => setPlace("extensions")}>Extensions of this project</Button>}>The Flows extension is off in this project. Its files stay and show as “needs the Flows extension”.</EmptyState></div>}
      {toast && <Toast className="u3-toast" tone="info" onDismiss={() => setToast(null)}>{toast}</Toast>}
    </div>
  );
}
