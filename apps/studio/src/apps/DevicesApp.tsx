import { useEffect, useRef, useState } from "preact/hooks";
import {
  CURVES, EFFECT_OPTIONS, EFFECT_RANDOM, effectName, effectSettingsOf, FIXTURE_KINDS, FIXTURE_LABEL_MAX, fixtureKind, PROVISION_STAGE_LABELS, PROVISION_STAGES, startState, TRIGGER_EFFECTS,
  type Curve, type EffectId, type EffectSettings, type FixtureKind, type FixtureLive, type LightCommand, type LightState, type ProvisionStage, type ProvisionState, type ScannedDevice,
} from "@openclapper/vocab";
import { Banner, Button, confirmDialog, cx, Empty, ErrorLine, Field, Icon, IconButton, Input, ListRow, Panel, PanelBody, PanelFoot, PanelHead, Seg, Select, Spinner, toast, Toolbar, ToolbarSpacer, ToolbarTitle } from "@openclapper/ui";
import { deleteFixture, fetchFixtures, putFixture, setFixturePower, type ServerFixture } from "../api";
import { BatteryChip, isBattery, minutesText, powerOf, takesBattery } from "../power";
import { Range } from "../compose/editor";
import { useLightProxy, type LightProxy } from "../lightProxy";
import { usePlayingFixtures } from "../sequencePlayback";
import type { AppProps } from "./registry";

/**
 * Devices (#307): the integrations by brand, the paired fixtures with their live state, and every
 * control their drivers support. The phone is the proxy (its Setup → Proxy screen): it holds the
 * Bluetooth connections, this app talks to it through the phone room.
 */

/** Brands with what is supported; Hollyland's picture stays on the phone (#302). */
const PHONE_ONLY = [{ brand: "Hollyland", models: ["Mars 400S Pro"], note: "Live picture on the phone (Setup → Live picture); not proxied." }];
const BRANDS = [...new Set(FIXTURE_KINDS.map((k) => k.brand))];

/** After a change here, the light's reports are ignored this long, or a late one would pull the control back (the phone's REPORT_HOLD_MS). */
const HOLD_MS = 1500;

const CURVE_LABELS: Record<Curve, string> = { linear: "Linear", exp: "Expo", log: "Log", s: "S-curve" };

function linkText(l: FixtureLive | undefined, proxyOn: boolean): string {
  if (!proxyOn) return "No proxy";
  if (!l) return "Not on the proxy phone";
  switch (l.link) {
    case "ready": return "Connected";
    case "connecting": return "Connecting…";
    case "retrying": return `Reconnecting (try ${l.attempt + 1})`;
    case "failed": return l.error ?? "Cannot connect";
    default: return "Not connected";
  }
}

export function DevicesApp(_p: AppProps) {
  const proxy = useLightProxy();
  const [fixtures, setFixtures] = useState<ServerFixture[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** At a glance (tiles with power) or the list by brand. */
  const [view, setView] = useState<"overview" | "list">("overview");
  const load = () => fetchFixtures().then((f) => { setFixtures(f.sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true }))); setError(null); }).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  // A fixture the proxy holds but this list lacks was paired since: fetch again.
  const liveIds = proxy.proxy?.fixtures.map((f) => f.id).join(",") ?? "";
  useEffect(() => { if (fixtures && proxy.proxy?.fixtures.some((l) => !fixtures.some((f) => f.id === l.id))) void load(); }, [liveIds]);

  const live = (id: string) => proxy.proxy?.fixtures.find((l) => l.id === id);
  const selected = adding ? null : fixtures?.find((f) => f.id === sel) ?? null;
  // A pairing finished on the phone: its mesh address is on the server now.
  const doneKey = Object.values(proxy.provisioning).filter((s) => s.phase === "done").map((s) => s.fixtureId).join(",");
  useEffect(() => { if (doneKey) void load(); }, [doneKey]);
  const changed = (selectId: string | null) => { proxy.request({ type: "lights.sync" }); void load(); setSel(selectId); };
  return (
    <>
      <Toolbar>
        <ToolbarTitle icon="access-point" count={fixtures?.length}>Devices</ToolbarTitle>
        <Seg label="View" value={view} onChange={setView} options={[{ id: "overview", icon: "view-dashboard-outline", title: "At a glance" }, { id: "list", icon: "format-list-bulleted", title: "By brand" }]} />
        <ToolbarSpacer />
        <ProxyChip proxy={proxy} />
        <Button size="sm" icon="plus" disabled={!proxy.proxy} title={proxy.proxy ? undefined : "Needs the phone's proxy"} onClick={() => { setSel(null); setAdding(true); }}>Add device</Button>
        <IconButton icon="refresh" label="Reload the list" onClick={() => void load()} />
      </Toolbar>
      <div class="f-app__body">
        <div class="f-scroll devices-list">
          {!proxy.proxy && <div class="devices-banner"><ProxyBanner proxy={proxy} /></div>}
          {error && <ErrorLine>{error}</ErrorLine>}
          {view === "overview" && fixtures && <Overview fixtures={fixtures} live={live} proxyOn={!!proxy.proxy} sel={sel} onSelect={setSel} />}
          {view === "list" && BRANDS.map((brand) => {
            const kinds = FIXTURE_KINDS.filter((k) => k.brand === brand);
            const mine = (fixtures ?? []).filter((f) => fixtureKind(f.kind_id)?.brand === brand);
            return (
              <section key={brand} class="devices-brand">
                <h3 class="section-title">{brand}</h3>
                <p class="meta">{kinds.map((k) => k.model).join(" · ")}</p>
                {mine.length === 0 && <p class="meta is-dim">None paired.</p>}
                {mine.map((f) => {
                  const l = live(f.id);
                  const k = fixtureKind(f.kind_id);
                  const battery = l?.telemetry?.battery;
                  return (
                    <ListRow key={f.id} selected={f.id === sel} onClick={() => setSel(f.id)}
                      thumb={<span class={cx("devices-dot", l?.link === "ready" ? "is-ok" : l?.link === "failed" ? "is-bad" : "is-off")} />}
                      title={f.label} meta={[k?.model, linkText(l, !!proxy.proxy), battery != null ? `${Math.round(battery)} %` : null].filter(Boolean).join(" · ")} />
                  );
                })}
              </section>
            );
          })}
          {view === "list" && PHONE_ONLY.map((b) => (
            <section key={b.brand} class="devices-brand">
              <h3 class="section-title">{b.brand}</h3>
              <p class="meta">{b.models.join(" · ")}</p>
              <p class="meta is-dim">{b.note}</p>
            </section>
          ))}
          <p class="meta devices-foot">The phone pairs and connects (Setup → Proxy, kept open); the list is stored on the server.</p>
        </div>
        {adding && fixtures && (
          <AddDevicePanel fixtures={fixtures} proxy={proxy} onClose={() => setAdding(false)} onPaired={(id) => { setAdding(false); changed(id); }} />
        )}
        {selected && fixtures && (
          <FixturePanel key={selected.id} f={selected} fixtures={fixtures} liveOf={live} live={live(selected.id)} proxy={proxy} onClose={() => setSel(null)} onChanged={changed} />
        )}
        {!selected && !adding && fixtures && fixtures.length > 0 && (
          <Panel label="Device"><PanelBody><Empty icon="gesture-tap" title="Pick a device">Its controls and readings show here.</Empty></PanelBody></Panel>
        )}
      </div>
    </>
  );
}

function ProxyChip({ proxy }: { proxy: LightProxy }) {
  const p = proxy.proxy;
  const text = !proxy.connected ? "Offline" : p ? `Proxy: ${p.phone.model ?? "phone"}` : proxy.phones.length ? "Phone open, proxy off" : "No phone";
  return <span class={cx("devices-chip", p ? "is-ok" : "is-off")}><Icon name={p ? "access-point" : "access-point-off"} />{text}</span>;
}

function ProxyBanner({ proxy }: { proxy: LightProxy }) {
  if (!proxy.connected) return <Banner kind="warn" icon="cloud-off-outline" title="Not connected to the server" meta="Retrying…" />;
  if (proxy.phones.length) return <Banner kind="info" icon="cellphone" title="The phone is open, but its proxy is off" meta="On the phone: Setup → Proxy, and keep that screen open." />;
  return <Banner kind="info" icon="cellphone-off" title="No phone connected" meta="Open OpenClapper on the phone that paired the lights, then Setup → Proxy." />;
}

/** A frequency or speed step: 11 is Random; Cop car's flash shows 6..10 as cycles. */
const stepLabel = (x: number, max: number, cycles?: boolean) => (max === 11 && x >= EFFECT_RANDOM ? "Random" : cycles && x > 5 ? `Cycle ${x - 5}` : String(x));
const minutes = (m: number) => (m >= 24 * 60 ? "over 24 h" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`);

/**
 * One fixture's controls. They start from what the light reports (Aputure) or what the phone last
 * set (NEEWER), follow its reports, and ignore them for HOLD_MS after a change made here.
 */
function FixturePanel({ f, fixtures, liveOf, live, proxy, onClose, onChanged }: { f: ServerFixture; fixtures: ServerFixture[]; liveOf: (id: string) => FixtureLive | undefined; live: FixtureLive | undefined; proxy: LightProxy; onClose: () => void; onChanged: (selectId: string | null) => void }) {
  const kind = fixtureKind(f.kind_id);
  const [v, setV] = useState<LightState>(() => ({ ...(kind ? startState(kind) : {}), ...live?.state }));
  const touched = useRef(0);
  const reported = JSON.stringify(live?.state ?? {});
  useEffect(() => { if (Date.now() - touched.current > HOLD_MS) setV((cur) => ({ ...cur, ...live?.state })); }, [reported]);
  // A sequence is playing this light: hands off, a manual change would fight its fades (#289).
  const inSequence = usePlayingFixtures().has(f.id);
  /** NEEWER smoothing as last set here; the phone switches it on (smooth) when it connects. */
  const [smooth, setSmooth] = useState(true);
  const [mode, setMode] = useState<"cct" | "hsi">(() => (live?.state.hsi && !live.state.cct ? "hsi" : "cct"));
  if (!kind) return <Panel label="Device"><PanelHead title={f.label}><IconButton icon="close" label="Close" onClick={onClose} /></PanelHead><PanelBody><ErrorLine>{`Unknown kind ${f.kind_id}`}</ErrorLine></PanelBody></Panel>;
  const caps = kind.caps;
  const ready = live?.link === "ready" && !inSequence;
  const send = (patch: LightState, cmd: LightCommand) => { touched.current = Date.now(); setV((cur) => ({ ...cur, ...patch })); proxy.send(f.id, cmd); };
  const cct = v.cct ?? { kelvin: 5600, gm: 0 };
  const col = v.hsi ?? { h: 0, s: 1, i: v.intensity ?? 0.5 };
  const hsiMode = caps.hsi && mode === "hsi";
  const controllable = caps.power || caps.intensity || !!caps.cct;
  return (
    <Panel label="Device" width="380px">
      <PanelHead title={f.label}><IconButton icon="close" label="Close" onClick={onClose} /></PanelHead>
      <PanelBody>
        <p class="meta">{`${kind.brand} ${kind.model} · ${f.address}${f.mesh_unicast != null ? ` · mesh ${f.mesh_unicast}` : ""}`}</p>
        <Banner kind={ready ? "ok" : live?.link === "failed" ? "warn" : "info"} icon="bluetooth" title={linkText(live, !!proxy.proxy)} />
        {inSequence && <Banner kind="info" icon="chart-timeline-variant" title="Playing in a sequence" meta="The controls are locked until the sequence stops." />}
        <fieldset class="devices-controls" disabled={!ready}>
          {controllable && caps.power && (
            <Seg label="Power" value={v.power === undefined ? "" as "on" : v.power ? "on" : "off"} onChange={(x) => send({ power: x === "on" }, { op: "power", on: x === "on" })}
              options={[{ id: "off", label: "Off" }, { id: "on", label: "On" }]} />
          )}
          {caps.intensity && (
            <Range label="Intensity" value={Math.round((v.intensity ?? 0.5) * 100)} min={0} max={100} step={1} format={(x) => `${x} %`}
              onChange={(x) => send({ intensity: x / 100 }, { op: "intensity", value: x / 100 })} />
          )}
          {!!caps.effects?.length && (
            <EffectControls effects={caps.effects} v={v} cct={caps.cct} send={send} trigger={() => proxy.send(f.id, { op: "trigger" })} />
          )}
          {caps.hsi && caps.cct && (
            <Seg label="Mode" value={mode} options={[{ id: "cct", label: "White" }, { id: "hsi", label: "Colour" }]}
              onChange={(m) => { setMode(m); if (m === "hsi") send({ hsi: col }, { op: "hsi", h: col.h, s: col.s, i: v.intensity ?? col.i }); else send({ cct }, { op: "cct", kelvin: cct.kelvin, gm: cct.gm }); }} />
          )}
          {hsiMode && (
            <>
              <Range label="Hue" value={Math.round(col.h)} min={0} max={360} step={1} format={(x) => `${x}°`}
                onChange={(x) => send({ hsi: { ...col, h: x } }, { op: "hsi", h: x, s: col.s, i: v.intensity ?? col.i })} />
              <Range label="Saturation" value={Math.round(col.s * 100)} min={0} max={100} step={1} format={(x) => `${x} %`}
                onChange={(x) => send({ hsi: { ...col, s: x / 100 } }, { op: "hsi", h: col.h, s: x / 100, i: v.intensity ?? col.i })} />
            </>
          )}
          {caps.cct && !hsiMode && (
            <Range label="White" value={cct.kelvin} min={caps.cct.min} max={caps.cct.max} step={100} format={(x) => `${x} K`}
              onChange={(x) => send({ cct: { ...cct, kelvin: x } }, { op: "cct", kelvin: x, gm: cct.gm })} />
          )}
          {caps.cct?.gm && !hsiMode && (
            <Range label="Green / magenta" value={cct.gm} min={caps.cct.gm.min} max={caps.cct.gm.max} step={1} format={(x) => (x > 0 ? `+${x} M` : x < 0 ? `${-x} G` : "neutral")}
              onChange={(x) => send({ cct: { ...cct, gm: x } }, { op: "cct", kelvin: cct.kelvin, gm: x })} />
          )}
          {caps.smoothing && (
            <div class="devices-field"><span class="section-title">Changes</span>
              <Seg label="Smooth or instant changes" value={smooth ? "smooth" : "instant"} onChange={(x) => { setSmooth(x === "smooth"); proxy.send(f.id, { op: "smooth", on: x === "smooth" }); }}
                options={[{ id: "smooth", label: "Smooth" }, { id: "instant", label: "Instant" }]} />
            </div>
          )}
          {caps.curves && !hsiMode && (
            <div class="devices-field"><span class="section-title">Dimming curve</span>
              <Seg label="Dimming curve" value={v.curve ?? ("" as Curve)} onChange={(x) => send({ curve: x }, { op: "curve", curve: x })} options={CURVES.map((c) => ({ id: c, label: CURVE_LABELS[c] }))} />
            </div>
          )}
        </fieldset>
        {caps.fade && (
          <FadeTest disabled={!ready} onFade={(intensity, ms, curve) => send({ intensity, effect: null }, { op: "fade", ms, curve, intensity, ...(hsiMode ? { colour: { h: col.h, s: col.s } } : { white: { kelvin: cct.kelvin, gm: cct.gm } }) })} />
        )}
        {takesBattery(f) && <PowerSource f={f} fixtures={fixtures} liveOf={liveOf} onChanged={onChanged} />}
        {caps.telemetry.length > 0 && <Readings live={live} estimated={!!caps.capacityWh} />}
        {isBattery(f) && (() => { const powers = fixtures.find((x) => x.powered_by === f.id); return <p class="meta">{powers ? `Powers ${powers.label}.` : "Powers no light (assign it on the light)."}</p>; })()}
        {!proxy.proxy && <p class="meta">Controls work once the phone's proxy is on.</p>}
        {kind.transport === "mesh" && <MeshSection f={f} proxy={proxy} />}
        <Manage f={f} onChanged={onChanged} />
      </PanelBody>
    </Panel>
  );
}

function EffectControls({ effects, v, cct, send, trigger }: { effects: readonly EffectId[]; v: LightState; cct: FixtureKind["caps"]["cct"]; send: (patch: LightState, cmd: LightCommand) => void; trigger: () => void }) {
  const fx = v.effect ?? null;
  const spec = fx ? EFFECT_OPTIONS[fx] : undefined;
  const o = fx ? effectSettingsOf(fx, v.effectSettings) : {};
  const mid = cct ? Math.round((cct.min + cct.max) / 200) * 100 : 5600;
  const set = (next: EffectSettings) => fx && send({ effectSettings: next }, { op: "effect", effect: fx, settings: next });
  const kelvin = (label: string, value: number, on: (k: number) => void) => cct
    ? <Range key={label} label={label} value={value} min={cct.min} max={cct.max} step={100} format={(x) => `${x} K`} onChange={on} />
    : null;
  return (
    <div class="devices-field">
      <span class="section-title">Effect</span>
      <Select label="Effect" value={fx ?? "off"} onChange={(id) => { const next = id === "off" ? null : (id as EffectId); send({ effect: next }, { op: "effect", effect: next }); }}
        options={[{ value: "off", label: "Off" }, ...effects.map((id) => ({ value: id, label: effectName(id) }))]} />
      {fx && <p class="meta">Intensity applies to the effect; choose White or Colour to stop it.</p>}
      {fx && spec?.options.map((opt) => {
        switch (opt.key) {
          case "frequency":
          case "speed":
            return <Range key={opt.key} label={opt.label} value={o[opt.key] ?? 5} min={1} max={opt.max} step={1} format={(x) => stepLabel(x, opt.max, opt.cycles)} onChange={(x) => set({ ...o, [opt.key]: x })} />;
          case "kelvin":
            return kelvin(`Effect ${opt.label.toLowerCase()}`, o.kelvin ?? mid, (k) => set({ ...o, kelvin: k }));
          case "ember":
            return <Range key={opt.key} label={opt.label} value={o.ember ?? 5} min={1} max={10} step={1} onChange={(x) => set({ ...o, ember: x })} />;
          case "intensityRange":
            return (
              <div key={opt.key} class="devices-field">
                <Range label={`${opt.label}: from`} value={Math.round((o.intensityMin ?? 0) * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ ...o, intensityMin: x / 100, intensityMax: Math.max(x / 100, o.intensityMax ?? 0.5) })} />
                <Range label={`${opt.label}: to`} value={Math.round((o.intensityMax ?? 0.5) * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ ...o, intensityMax: x / 100, intensityMin: Math.min(x / 100, o.intensityMin ?? 0) })} />
              </div>
            );
          case "kelvinRange":
            return cct ? (
              <div key={opt.key} class="devices-field">
                <Range label={`${opt.label}: from`} value={o.kelvin ?? cct.min} min={cct.min} max={cct.max} step={100} format={(x) => `${x} K`} onChange={(x) => set({ ...o, kelvin: x, kelvinMax: Math.max(x, o.kelvinMax ?? cct.max) })} />
                <Range label={`${opt.label}: to`} value={o.kelvinMax ?? cct.max} min={cct.min} max={cct.max} step={100} format={(x) => `${x} K`} onChange={(x) => set({ ...o, kelvinMax: x, kelvin: Math.min(x, o.kelvin ?? cct.min) })} />
              </div>
            ) : null;
          case "saturation":
            return <Range key={opt.key} label={opt.label} value={Math.round((o.saturation ?? 1) * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ ...o, saturation: x / 100 })} />;
          case "choice":
            return (
              <Select key={opt.key} label={opt.label} prefix={opt.label} value={String(o.choice ?? 0)} onChange={(x) => set({ ...o, choice: Number(x) })}
                options={opt.values.map((label, i) => ({ value: String(i), label }))} />
            );
          case "color": {
            const color = o.color ?? { h: 0, s: 1 };
            return (
              <div key={opt.key} class="devices-field">
                <Seg label="Effect colour" value={"kelvin" in color ? "white" : "colour"} options={[{ id: "white", label: "White" }, { id: "colour", label: "Colour" }]}
                  onChange={(m) => set({ ...o, color: m === "white" ? { kelvin: mid } : { h: 0, s: 1 } })} />
                {"kelvin" in color ? kelvin("Effect white", color.kelvin, (k) => set({ ...o, color: { kelvin: k } })) : (
                  <>
                    <Range label="Effect hue" value={Math.round(color.h)} min={0} max={360} step={1} format={(x) => `${x}°`} onChange={(x) => set({ ...o, color: { ...color, h: x } })} />
                    <Range label="Effect saturation" value={Math.round(color.s * 100)} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => set({ ...o, color: { ...color, s: x / 100 } })} />
                  </>
                )}
              </div>
            );
          }
          default: return null;
        }
      })}
      {fx && TRIGGER_EFFECTS.includes(fx) && <Button kind="secondary" size="sm" icon="flash" onClick={trigger}>Strike now</Button>}
    </div>
  );
}

/** Battery readout: the PS099S every second (time left estimated on the phone), an MC's built-in battery every minute. */
function Readings({ live, estimated }: { live: FixtureLive | undefined; estimated: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => { const h = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(h); }, []);
  const t = live?.telemetry;
  if (!t || t.battery === undefined) return <p class="meta">{live?.link === "ready" ? "Waiting for the first reading…" : "Readings start once connected."}</p>;
  const rows: [string, string][] = [["Charge", `${t.battery} %`]];
  if (t.volts !== undefined) rows.push(["Voltage", `${t.volts.toFixed(2)} V`]);
  if (t.amps !== undefined) rows.push(["Current", `${t.amps.toFixed(2)} A`]);
  if (t.watts !== undefined) rows.push(["Power", `${t.watts < 10 ? t.watts.toFixed(1) : Math.round(t.watts)} W`]);
  if (t.discharging !== undefined) rows.push(["State", t.discharging ? "Feeding a load" : "Idle"]);
  if (t.plugged !== undefined) rows.push(["Power source", t.plugged ? "External supply" : "Battery"]);
  rows.push(["Time left", t.minutesLeft !== undefined ? `about ${minutes(t.minutesLeft)}` : "–"]);
  const age = Math.round((Date.now() - t.at) / 1000);
  return (
    <div class="devices-field">
      <span class="section-title">Battery</span>
      <dl class="f-facts">{rows.map(([k, val]) => <><dt key={`${k}-k`}>{k}</dt><dd key={`${k}-v`} class="num">{val}</dd></>)}</dl>
      <p class="meta">{age > (estimated ? 5 : 75) ? `No new reading for ${age} s` : estimated ? "Every second; time left estimated from the rated energy." : "Reported by the light every minute."}</p>
    </div>
  );
}

/** The next free "MC 3" style name for a model. */
function defaultLabel(kind: FixtureKind, fixtures: ServerFixture[]): string {
  const taken = new Set(fixtures.map((f) => f.label));
  for (let n = fixtures.filter((f) => f.kind_id === kind.id).length + 1; ; n++) if (!taken.has(`${kind.model} ${n}`)) return `${kind.model} ${n}`;
}

/**
 * Add device (#307): the phone scans, the list shows here live; pick one, confirm the model, name it.
 * NEEWER devices need no pairing on the device: the record is enough, and the proxy connects. An
 * Aputure light is then provisioned into the phone's mesh, with each step shown.
 */
function AddDevicePanel({ fixtures, proxy, onClose, onPaired }: { fixtures: ServerFixture[]; proxy: LightProxy; onClose: () => void; onPaired: (id: string) => void }) {
  const [pick, setPick] = useState<ScannedDevice | null>(null);
  const [kindId, setKindId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  useEffect(() => { proxy.request({ type: "lights.scan", on: true }); return () => proxy.request({ type: "lights.scan", on: false }); }, []);
  const scan = proxy.scan;
  const kind = kindId ? fixtureKind(kindId) : undefined;
  const progress = pairing ? proxy.provisioning[pairing] : undefined;
  useEffect(() => { if (pairing && progress?.phase === "done") { toast(`“${label || (kind ? defaultLabel(kind, fixtures) : "")}” paired`); onPaired(pairing); } }, [progress?.phase]);

  const choose = (d: ScannedDevice) => { setPick(d); setError(null); if (d.kinds[0] && (!kindId || !d.kinds.includes(kindId))) setKindId(d.kinds[0]); };
  const pair = async () => {
    if (!pick || !kind) return;
    setBusy(true); setError(null);
    try {
      const f = await putFixture({ id: crypto.randomUUID(), label: label.trim() || defaultLabel(kind, fixtures), kind_id: kind.id, address: pick.address });
      proxy.request({ type: "lights.sync" });
      if (kind.transport === "mesh") { setPairing(f.id); proxy.request({ type: "lights.provision", fixtureId: f.id }); }
      else { toast(`“${f.label}” added`); onPaired(f.id); }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (pairing) return (
    <Panel label="Pairing" width="380px">
      <PanelHead title="Pairing"><IconButton icon="close" label="Close" onClick={() => onPaired(pairing)} /></PanelHead>
      <PanelBody>
        <p class="meta">The phone is pairing the light with its mesh network; its other connections pause meanwhile. About half a minute.</p>
        <ProvisionSteps p={progress} />
        {progress?.phase === "error" && <Button size="sm" kind="secondary" icon="refresh" onClick={() => proxy.request({ type: "lights.provision", fixtureId: pairing })}>Try again</Button>}
      </PanelBody>
    </Panel>
  );

  const taken = (a: string) => fixtures.find((f) => f.address === a);
  const kindOptions = [...(pick?.kinds ?? []), ...FIXTURE_KINDS.map((k) => k.id).filter((id) => !pick?.kinds.includes(id))].map((id) => ({ value: id, label: `${fixtureKind(id)!.brand} ${fixtureKind(id)!.model}`, group: pick?.kinds.includes(id) ? "Looks like" : "Other models" }));
  return (
    <Panel label="Add device" width="380px">
      <PanelHead title="Add device"><IconButton icon="close" label="Close" onClick={onClose} /></PanelHead>
      <PanelBody>
        <p class="meta">Switch the device on and close the maker's app. An Aputure light must not be in Sidus Link (remove it there, or reset it).</p>
        <div class="btn-row">
          {scan?.phase === "scanning" ? <><Spinner /><span class="meta">Scanning on the phone…</span></> : <Button size="sm" kind="secondary" icon="refresh" onClick={() => proxy.request({ type: "lights.scan", on: true })}>Scan again</Button>}
        </div>
        {scan?.phase === "error" && <ErrorLine>{scan.message}</ErrorLine>}
        <div class="devices-found">
          {(scan?.found ?? []).map((d) => {
            const t = taken(d.address);
            const k = d.kinds[0] ? fixtureKind(d.kinds[0]) : undefined;
            return (
              <ListRow key={d.address} selected={pick?.address === d.address} aria-disabled={!!t} class={t ? "is-dim" : undefined} onClick={() => { if (!t) choose(d); }}
                thumb={<Icon name={k ? "lightbulb-outline" : "bluetooth"} />} title={d.name ?? "Unnamed device"}
                meta={[k ? `Looks like ${k.brand} ${k.model}` : null, t ? `already added as ${t.label}` : null, d.address, d.rssi != null ? `${d.rssi} dBm` : null].filter(Boolean).join(" · ")} />
            );
          })}
          {scan?.phase === "done" && scan.found.length === 0 && <p class="meta">Nothing found. Is it on and close to the phone?</p>}
        </div>
        {pick && (
          <>
            <Field as="div" label="Model"><Select label="Model" value={kindId ?? ""} onChange={setKindId} options={kindOptions} /></Field>
            <Field label="Name"><Input sm value={label} maxLength={FIXTURE_LABEL_MAX} placeholder={kind ? defaultLabel(kind, fixtures) : "e.g. Key left"} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} /></Field>
          </>
        )}
        {error && <ErrorLine>{error}</ErrorLine>}
      </PanelBody>
      <PanelFoot>
        <Button icon={kind?.transport === "mesh" ? "link-variant" : "check"} disabled={!pick || !kind || busy} onClick={() => void pair()}>{kind?.transport === "mesh" ? "Pair" : "Add"}</Button>
      </PanelFoot>
    </Panel>
  );
}

/** The pairing steps as the phone reports them. */
function ProvisionSteps({ p }: { p: ProvisionState | undefined }) {
  const stages: readonly ProvisionStage[] = p?.resume ? PROVISION_STAGES.filter((s) => s === "reconnect" || s === "configure") : PROVISION_STAGES;
  const at = p?.stage ? stages.indexOf(p.stage) : -1;
  return (
    <>
      <ol class="devices-steps">
        {stages.map((s, i) => {
          const done = p?.phase === "done" || i < at;
          const now = p?.phase === "running" && i === Math.max(0, at);
          const failed = p?.phase === "error" && i === Math.max(0, at);
          return <li key={s} class={cx(done && "is-done", now && "is-now", failed && "is-failed")}><Icon name={done ? "check-circle" : failed ? "alert-circle-outline" : now ? "progress-clock" : "circle-outline"} />{PROVISION_STAGE_LABELS[s]}</li>;
        })}
      </ol>
      {!p && <p class="meta">Waiting for the phone…</p>}
      {p?.phase === "error" && <ErrorLine>{p.error ?? "Pairing stopped."}</ErrorLine>}
    </>
  );
}

/** An Aputure light's place in the phone's mesh: pair it, run its setup again, or pair again after a reset. */
function MeshSection({ f, proxy }: { f: ServerFixture; proxy: LightProxy }) {
  const p = proxy.provisioning[f.id];
  const running = p?.phase === "running";
  const go = (fresh: boolean) => proxy.request({ type: "lights.provision", fixtureId: f.id, fresh });
  return (
    <div class="devices-field">
      <span class="section-title">Mesh</span>
      <p class="meta">{f.mesh_unicast == null ? "Not on OpenClapper's mesh yet. Pairing takes it out of Sidus Link." : `On the phone's mesh at address ${f.mesh_unicast}${(f.mesh_elements ?? 1) > 1 ? `–${f.mesh_unicast + (f.mesh_elements ?? 1) - 1}` : ""}.`}</p>
      {p && <ProvisionSteps p={p} />}
      <div class="btn-row">
        {f.mesh_unicast == null
          ? <Button size="sm" icon="link-variant" disabled={!proxy.proxy || running} onClick={() => go(false)}>Pair with OpenClapper</Button>
          : <>
              <Button size="sm" kind="secondary" icon="cog-outline" disabled={!proxy.proxy || running} onClick={() => go(false)}>Run setup again</Button>
              <Button size="sm" kind="secondary" icon="link-variant" disabled={!proxy.proxy || running} onClick={() => go(true)} title="After resetting the light: a fresh pairing at a new address">Pair again</Button>
            </>}
      </div>
    </div>
  );
}

/** Rename or delete; the phone takes the change on `lights.sync`. The device itself is not changed. */
function Manage({ f, onChanged }: { f: ServerFixture; onChanged: (selectId: string | null) => void }) {
  const [label, setLabel] = useState(f.label);
  const [error, setError] = useState<string | null>(null);
  const rename = async () => {
    const next = label.trim();
    if (!next || next === f.label) { setLabel(f.label); return; }
    try { await putFixture({ ...f, label: next }); onChanged(f.id); } catch (e) { setError((e as Error).message); }
  };
  const remove = async () => {
    const mesh = f.mesh_unicast != null;
    const ok = await confirmDialog({ title: `Delete “${f.label}”?`, body: `Removes it from the list on the server and the phone.${mesh ? " The light keeps the phone's mesh keys: reset it before pairing it again or adding it to Sidus Link." : ""}`, confirmLabel: "Delete", danger: true });
    if (ok !== true) return;
    try { await deleteFixture(f.id); toast(`“${f.label}” deleted`); onChanged(null); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div class="devices-field devices-manage">
      <span class="section-title">Device</span>
      <Field label="Name"><Input sm value={label} maxLength={FIXTURE_LABEL_MAX} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} onBlur={() => void rename()} onKeyDown={(e) => { if (e.key === "Enter") void rename(); }} /></Field>
      {error && <ErrorLine>{error}</ErrorLine>}
      <div class="btn-row"><Button size="sm" kind="danger" icon="delete-outline" onClick={() => void remove()}>Delete</Button></div>
    </div>
  );
}

/**
 * The light's own fade (#289), to try before sequences use it: the light fades to the target by
 * itself over the time, with the curve, in the current white or colour, then holds it.
 */
function FadeTest({ disabled, onFade }: { disabled: boolean; onFade: (intensity: number, ms: number, curve: Curve) => void }) {
  const [to, setTo] = useState(100);
  const [secs, setSecs] = useState(5);
  const [curve, setCurve] = useState<Curve>("linear");
  return (
    <div class="devices-field devices-manage">
      <span class="section-title">Native fade (test)</span>
      <p class="meta">The light fades by itself, without stepping, up to 25.5 s. Watch where it starts from and whether it holds the target.</p>
      <Range label="To" value={to} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={setTo} />
      <Range label="Over" value={secs} min={0.5} max={25.5} step={0.5} format={(x) => `${x.toFixed(1)} s`} onChange={setSecs} />
      <Seg label="Fade curve" value={curve} onChange={setCurve} options={CURVES.map((c) => ({ id: c, label: CURVE_LABELS[c] }))} />
      <div class="btn-row"><Button size="sm" icon="transition" disabled={disabled} onClick={() => onFade(to / 100, Math.round(secs * 1000), curve)}>Fade</Button></div>
    </div>
  );
}

/**
 * At a glance (#294): a tile per device with its connection and power. A COB shows the battery it is
 * assigned (or its socket), a battery the light it powers.
 */
function Overview({ fixtures, live, proxyOn, sel, onSelect }: { fixtures: ServerFixture[]; live: (id: string) => FixtureLive | undefined; proxyOn: boolean; sel: string | null; onSelect: (id: string) => void }) {
  if (fixtures.length === 0) return <Empty icon="lightbulb-outline" title="No devices yet">Add one with Add device (the phone's proxy must be on).</Empty>;
  return (
    <div class="power-grid">
      {fixtures.map((f) => {
        const l = live(f.id);
        const k = fixtureKind(f.kind_id);
        const pw = powerOf(f, fixtures, live);
        const powers = isBattery(f) ? fixtures.find((x) => x.powered_by === f.id) : undefined;
        const level = pw.pct === null ? null : pw.pct < 10 ? "is-critical" : pw.pct < 25 ? "is-low" : "";
        return (
          <button key={f.id} type="button" class={cx("power-tile", f.id === sel && "is-selected")} onClick={() => onSelect(f.id)}>
            <span class="power-tile__head">
              <span class={cx("devices-dot", l?.link === "ready" ? "is-ok" : l?.link === "failed" ? "is-bad" : "is-off")} title={linkText(l, proxyOn)} />
              <span class="power-tile__name">{f.label}</span>
              <span class="meta">{k?.model}</span>
            </span>
            {pw.source === "socket"
              ? <span class="power-tile__big"><BatteryChip power={pw} /></span>
              : <>
                  <span class="power-tile__big num">{pw.pct === null ? "–" : `${pw.pct} %`}</span>
                  <span class={cx("power-bar", level)}><span style={{ width: `${pw.pct ?? 0}%` }} /></span>
                </>}
            <span class="meta">{[
              pw.source === "battery" && pw.battery ? `on ${pw.battery.label}` : null,
              powers ? `powers ${powers.label}` : null,
              pw.minutesLeft !== undefined ? `about ${minutesText(pw.minutesLeft)} left` : null,
              pw.pct === null && pw.source !== "socket" ? (proxyOn ? "no reading yet" : "proxy off") : null,
            ].filter(Boolean).join(" · ") || "\u00a0"}</span>
          </button>
        );
      })}
    </div>
  );
}

/** What a COB runs on (#294): a socket, or one of the batteries; a battery powers one light at a time. */
function PowerSource({ f, fixtures, liveOf, onChanged }: { f: ServerFixture; fixtures: ServerFixture[]; liveOf: (id: string) => FixtureLive | undefined; onChanged: (selectId: string | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  const batteries = fixtures.filter(isBattery);
  const set = async (id: string) => {
    setError(null);
    try { await setFixturePower(f.id, id || null); onChanged(f.id); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div class="devices-field">
      <span class="section-title">Power</span>
      <Select label="Power source" value={f.powered_by ?? ""} onChange={(id) => void set(id)}
        options={[{ value: "", label: "Socket" }, ...batteries.map((b) => {
          const other = fixtures.find((x) => x.powered_by === b.id && x.id !== f.id);
          return { value: b.id, label: `${b.label}${other ? ` (now on ${other.label})` : ""}` };
        })]} />
      <div class="btn-row"><BatteryChip power={powerOf(f, fixtures, liveOf)} /></div>
      <p class="meta">The light cannot tell which battery feeds it: pick it here. A battery taken from another light leaves that one on Socket. Sequences show this battery next to the light's track.</p>
      {error && <ErrorLine>{error}</ErrorLine>}
    </div>
  );
}
