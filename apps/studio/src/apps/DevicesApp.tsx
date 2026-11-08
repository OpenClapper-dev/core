import { useEffect, useRef, useState } from "preact/hooks";
import {
  CURVES, EFFECT_OPTIONS, EFFECT_RANDOM, effectName, effectSettingsOf, FIXTURE_KINDS, fixtureKind, startState, TRIGGER_EFFECTS,
  type Curve, type EffectId, type EffectSettings, type FixtureKind, type FixtureLive, type LightCommand, type LightState,
} from "@openclapper/vocab";
import { Banner, Button, cx, Empty, ErrorLine, Icon, IconButton, ListRow, Panel, PanelBody, PanelHead, Seg, Select, Toolbar, ToolbarSpacer, ToolbarTitle } from "@openclapper/ui";
import { fetchFixtures, type ServerFixture } from "../api";
import { Range } from "../compose/editor";
import { useLightProxy, type LightProxy } from "../lightProxy";
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
  const load = () => fetchFixtures().then((f) => { setFixtures(f.sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true }))); setError(null); }).catch((e) => setError((e as Error).message));
  useEffect(() => { void load(); }, []);
  // A fixture the proxy holds but this list lacks was paired since: fetch again.
  const liveIds = proxy.proxy?.fixtures.map((f) => f.id).join(",") ?? "";
  useEffect(() => { if (fixtures && proxy.proxy?.fixtures.some((l) => !fixtures.some((f) => f.id === l.id))) void load(); }, [liveIds]);

  const live = (id: string) => proxy.proxy?.fixtures.find((l) => l.id === id);
  const selected = fixtures?.find((f) => f.id === sel) ?? null;
  return (
    <>
      <Toolbar>
        <ToolbarTitle icon="access-point" count={fixtures?.length}>Devices</ToolbarTitle>
        <ToolbarSpacer />
        <ProxyChip proxy={proxy} />
        <IconButton icon="refresh" label="Reload the list" onClick={() => void load()} />
      </Toolbar>
      <div class="f-app__body">
        <div class="f-scroll devices-list">
          {!proxy.proxy && <div class="devices-banner"><ProxyBanner proxy={proxy} /></div>}
          {error && <ErrorLine>{error}</ErrorLine>}
          {BRANDS.map((brand) => {
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
          {PHONE_ONLY.map((b) => (
            <section key={b.brand} class="devices-brand">
              <h3 class="section-title">{b.brand}</h3>
              <p class="meta">{b.models.join(" · ")}</p>
              <p class="meta is-dim">{b.note}</p>
            </section>
          ))}
          <p class="meta devices-foot">Pair new lights on the phone for now (Setup → Lights); pairing moves here next.</p>
        </div>
        {selected && (
          <FixturePanel key={selected.id} f={selected} live={live(selected.id)} proxy={proxy} onClose={() => setSel(null)} />
        )}
        {!selected && fixtures && fixtures.length > 0 && (
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
function FixturePanel({ f, live, proxy, onClose }: { f: ServerFixture; live: FixtureLive | undefined; proxy: LightProxy; onClose: () => void }) {
  const kind = fixtureKind(f.kind_id);
  const [v, setV] = useState<LightState>(() => ({ ...(kind ? startState(kind) : {}), ...live?.state }));
  const touched = useRef(0);
  const reported = JSON.stringify(live?.state ?? {});
  useEffect(() => { if (Date.now() - touched.current > HOLD_MS) setV((cur) => ({ ...cur, ...live?.state })); }, [reported]);
  const [mode, setMode] = useState<"cct" | "hsi">(() => (live?.state.hsi && !live.state.cct ? "hsi" : "cct"));
  if (!kind) return <Panel label="Device"><PanelHead title={f.label}><IconButton icon="close" label="Close" onClick={onClose} /></PanelHead><PanelBody><ErrorLine>{`Unknown kind ${f.kind_id}`}</ErrorLine></PanelBody></Panel>;
  const caps = kind.caps;
  const ready = live?.link === "ready";
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
          {caps.curves && !hsiMode && (
            <div class="devices-field"><span class="section-title">Dimming curve</span>
              <Seg label="Dimming curve" value={v.curve ?? ("" as Curve)} onChange={(x) => send({ curve: x }, { op: "curve", curve: x })} options={CURVES.map((c) => ({ id: c, label: CURVE_LABELS[c] }))} />
            </div>
          )}
        </fieldset>
        {caps.telemetry.length > 0 && <Readings live={live} estimated={!!caps.capacityWh} />}
        {!proxy.proxy && <p class="meta">Controls work once the phone's proxy is on.</p>}
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
