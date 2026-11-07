import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { fixtureKind, fixtureKindName, FIXTURE_LABEL_MAX, startState, effectName, effectSettingsOf, EFFECT_OPTIONS, EFFECT_RANDOM, TRIGGER_EFFECTS, type Capabilities, type EffectId, type EffectSettings, type FixtureKind, type LightState, type TelemetryField } from "@openclapper/vocab";
import { useApp } from "../appState";
import { adapterState, scan, type Seen } from "../ble/link";
import { askBluetooth } from "../ble/permissions";
import { linkLabel, sendToFixture, useFixtureLease, useFixtureStatus } from "../fixtures/hub";
import { deleteFixture, getFixtures, saveFixture, syncFixtures, useFixtures } from "../fixtures/library";
import { formatMinutes } from "../fixtures/batteryEstimate";
import { hasKeys, nodeState } from "../fixtures/meshNetworks";
import { overlapping } from "../fixtures/meshAddress";
import { provisionFixture, STAGES, type Stage } from "../fixtures/provisionFlow";
import { ALL_KINDS, suggestKinds } from "../fixtures/registry";
import type { Command, Fixture, Telemetry } from "../fixtures/types";
import { log } from "../log";
import { Banner, Block, Button, confirm, Empty, ErrorText, FieldRow, Hint, Input, ListRow, makeStyles, num, PushScreen, SectionLabel, Seg, SideBySide, Slider, toast, type, useTheme } from "../ui";
import { OptionSheet } from "../components/OptionSheet";

const kindIcon = (k: FixtureKind | undefined) => (k && !k.caps.power ? "battery-high" : "lightbulb-outline");
const kindName = (id: string) => { const k = fixtureKind(id); return k ? fixtureKindName(k) : `Unknown kind (${id})`; };

const TELEMETRY_WORDS: Record<TelemetryField, string> = { battery: "charge", volts: "voltage", amps: "current", watts: "power", minutesLeft: "time left" };

/** What a kind can be asked to do, in words. */
function capsLine(k: FixtureKind): string {
  const c = k.caps;
  return [
    c.intensity && "intensity",
    c.cct && `white ${c.cct.min}–${c.cct.max} K${c.cct.gm ? " + green/magenta" : ""}`,
    c.hsi && "colour",
    c.curves && "dimming curves",
    !!c.effects?.length && `${c.effects.length} effects`,
    c.telemetry.length > 0 && c.telemetry.map((t) => TELEMETRY_WORDS[t]).join(", ").replace("time left", c.capacityWh ? "estimated time left" : "battery time left"),
  ].filter(Boolean).join(" · ");
}

function fixtureMeta(f: Fixture): string {
  if (!f.synced) return `${kindName(f.kindId)} · not synced yet · saved on the phone`;
  const k = fixtureKind(f.kindId);
  const mesh = k?.transport === "mesh" ? (f.mesh ? ` · mesh ${f.mesh.unicast}` : " · not on a mesh yet") : "";
  return `${kindName(f.kindId)}${mesh}`;
}

/** Setup → Lights: every paired light and battery; tap = control, Add light = scan and pair. */
export function FixtureList() {
  const app = useApp();
  const fixtures = useFixtures();
  useEffect(() => { void syncFixtures(); }, []);
  return (
    <PushScreen title="Lights" sub={`${fixtures.length} paired · stored on the server`}
      footer={<Button style={{ flex: 1 }} icon="plus" label="Add light" onPress={() => app.push({ name: "fixtureEditor", fixtureId: null })} />}>
      {fixtures.length === 0 && <Empty icon="lightbulb-outline" title="No light yet" body="Pair NEEWER and Aputure lights and the NEEWER battery to control them from the phone." />}
      {fixtures.map((f) => (
        <ListRow key={f.id} icon={f.synced ? kindIcon(fixtureKind(f.kindId)) : "cloud-off-outline"} title={f.label} meta={fixtureMeta(f)}
          onPress={() => app.push({ name: "fixture", fixtureId: f.id })} onLongPress={() => app.push({ name: "fixtureEditor", fixtureId: f.id })} />
      ))}
    </PushScreen>
  );
}

/** How long one scan runs; lights advertise every second or so. */
const SCAN_MS = 10_000;

interface Found extends Seen { kinds: string[] }
type ScanState = { phase: "idle" | "scanning" | "done" } | { phase: "error"; message: string };

/** Scan nearby; the list keeps the strongest signal per device, likely fixtures first. */
function useScan(enabled: boolean) {
  const [state, setState] = useState<ScanState>({ phase: "idle" });
  const [found, setFound] = useState<Found[]>([]);
  const stop = useRef<(() => void) | null>(null);

  const run = async () => {
    stop.current?.();
    setFound([]);
    setState({ phase: "scanning" });
    if (!(await askBluetooth())) { setState({ phase: "error", message: "Bluetooth permission denied. Allow “Nearby devices” for OpenClapper in Android settings." }); return; }
    const adapter = await adapterState().catch(() => "unknown" as const);
    if (adapter !== "on") { setState({ phase: "error", message: adapter === "off" ? "Bluetooth is off. Switch it on and scan again." : `Bluetooth is not available (${adapter}).` }); return; }
    log("info", "fixture scan started");
    const end = setTimeout(() => { stop.current?.(); stop.current = null; setState({ phase: "done" }); }, SCAN_MS);
    const halt = scan(
      (d) => setFound((cur) => {
        const kinds = suggestKinds(d);
        if (!d.name && !kinds.length) return cur;
        const old = cur.find((x) => x.address === d.address);
        const next = { ...d, name: d.name ?? old?.name ?? null, kinds: kinds.length ? kinds : old?.kinds ?? [] };
        return old ? cur.map((x) => (x.address === d.address ? next : x)) : [...cur, next];
      }),
      (e) => { log("warn", "fixture scan failed", e); setState({ phase: "error", message: `Scan failed: ${e instanceof Error ? e.message : String(e)}` }); },
    );
    stop.current = () => { clearTimeout(end); halt(); };
  };

  useEffect(() => {
    if (enabled) void run();
    return () => { stop.current?.(); stop.current = null; };
  }, [enabled]);

  const sorted = [...found].sort((a, b) => Number(b.kinds.length > 0) - Number(a.kinds.length > 0) || (b.rssi ?? -999) - (a.rssi ?? -999));
  return { state, found: sorted, again: () => void run() };
}

/** Pair a new fixture (scan, pick, confirm the model) or edit one: label, model, delete. */
export function FixtureEditor({ fixtureId }: { fixtureId: string | null }) {
  const s = useStyles();
  const app = useApp();
  const existing = fixtureId ? getFixtures().find((f) => f.id === fixtureId) ?? null : null;
  const paired = useFixtures();
  const { state, found, again } = useScan(!existing);
  const [address, setAddress] = useState<string | null>(existing?.address ?? null);
  const [kindId, setKindId] = useState<string | null>(existing?.kindId ?? null);
  const [label, setLabel] = useState(existing?.label ?? "");
  const [sheet, setSheet] = useState(false);

  const kind = kindId ? fixtureKind(kindId) : undefined;
  const defaultLabel = kind ? `${kind.model} ${paired.filter((f) => f.kindId === kind.id && f.id !== existing?.id).length + 1}` : "";
  const err = !address ? "Pick a device from the list." : !kind ? "Pick the model." : null;

  const pick = (d: Found) => {
    setAddress(d.address);
    if (d.kinds[0] && (!kindId || !d.kinds.includes(kindId))) setKindId(d.kinds[0]);
  };

  const save = () => {
    if (err || !address || !kind) return;
    const f: Fixture = {
      id: existing?.id ?? Crypto.randomUUID(),
      label: label.trim() || defaultLabel,
      kindId: kind.id,
      address,
      // A changed model drops a mesh pairing that belonged to the old one.
      mesh: existing && existing.kindId === kind.id ? existing.mesh : null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      synced: false,
    };
    void saveFixture(f);
    toast(existing ? `“${f.label}” saved` : `“${f.label}” paired`);
    app.pop();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({ title: `Delete “${existing.label}”?`, body: "Removes it from this phone and the server. The light itself is not changed.", confirmLabel: "Delete", danger: true });
    if (ok === true) { void deleteFixture(existing.id); toast("Deleted", "neutral"); app.pop(); }
  };

  return (
    <PushScreen title={existing ? "Edit light" : "Add light"} sub={existing?.label}
      footer={<SideBySide>
        <Button style={{ flex: 1 }} kind="secondary" label="Cancel" onPress={app.pop} />
        <Button style={{ flex: 2 }} icon="check" label={existing ? "Save" : "Pair"} onPress={save} disabled={!!err} />
      </SideBySide>}>
      {!existing && (
        <>
          <Block>
            <SectionLabel>Nearby</SectionLabel>
            <Hint>Switch the light on and make sure no other phone is connected to it (close the maker's app).</Hint>
            {state.phase === "error" && <ErrorText>{state.message}</ErrorText>}
          </Block>
          {state.phase === "scanning" && found.length === 0 && <Empty loading icon="bluetooth" title="Looking for lights…" />}
          {found.map((d) => {
            const taken = paired.find((f) => f.address === d.address);
            return (
              <ListRow key={d.address} icon={d.kinds.length ? "lightbulb-outline" : "bluetooth"} title={d.name ?? "Unnamed device"} selected={address === d.address} disabled={!!taken}
                meta={[d.kinds.length ? `Looks like ${kindName(d.kinds[0])}` : null, taken ? `already paired as ${taken.label}` : null, d.address, d.rssi != null ? `${d.rssi} dBm` : null].filter(Boolean).join(" · ")}
                onPress={() => pick(d)} />
            );
          })}
          {state.phase === "done" && found.length === 0 && <Empty icon="bluetooth-off" title="Nothing found" body="Is the light on and close by? Some lights only advertise in their app or Bluetooth mode." />}
          {state.phase !== "scanning" && <Block><Button kind="secondary" icon="refresh" label="Scan again" onPress={again} /></Block>}
        </>
      )}
      <Block>
        <SectionLabel>Light</SectionLabel>
      </Block>
      <FieldRow icon="lightbulb-outline" label="Model" value={kind ? fixtureKindName(kind) : null} placeholder="Pick the model" onPress={() => setSheet(true)} />
      {kind && <Block><Hint>{capsLine(kind)}</Hint></Block>}
      <Block>
        <SectionLabel>Name</SectionLabel>
        <Input value={label} onChangeText={setLabel} placeholder={defaultLabel || "e.g. Key left"} maxLength={FIXTURE_LABEL_MAX} />
        {address && <Text style={s.address}>{address}</Text>}
        {kind?.transport === "mesh" && <Hint>{existing?.mesh ? `On mesh network as address ${existing.mesh.unicast}.` : "Not on a mesh network yet: pairing Aputure lights needs mesh support, which comes in a later update."}</Hint>}
      </Block>
      {existing && <Block><Button kind="danger" icon="delete-outline" label="Delete" onPress={() => void remove()} /></Block>}
      <OptionSheet visible={sheet} title="Model" options={ALL_KINDS.map((k) => ({ id: k.id, label: fixtureKindName(k), meta: capsLine(k) }))} value={kindId ? [kindId] : []} list
        onChange={(ids) => ids[0] && setKindId(ids[0])} onClose={() => setSheet(false)} />
    </PushScreen>
  );
}

const CURVE_OPTIONS = [
  { id: "linear", label: "Linear" },
  { id: "exp", label: "Expo" },
  { id: "log", label: "Log" },
  { id: "s", label: "S" },
] as const;

/**
 * Where a mesh light stands with the phone's network (#212): not paired, paired on another phone,
 * provisioned but not configured, or ready.
 */
function MeshPairing({ f }: { f: Fixture }) {
  const app = useApp();
  const open = (fresh = false) => app.push({ name: "fixtureProvision", fixtureId: f.id, fresh });
  if (!f.mesh) return (
    <>
      <Hint>Not on OpenClapper's mesh yet. Pairing takes it out of Sidus Link.</Hint>
      <Button icon="link-variant" label="Pair with OpenClapper" onPress={() => open()} />
    </>
  );
  if (!hasKeys(f.mesh.networkId)) return <Hint>Paired on another phone: this light's network keys are not on this one.</Hint>;
  const node = nodeState(f.mesh.networkId, f.mesh.unicast);
  if (!node?.configured) return (
    <>
      <Hint>Paired, but the setup did not finish.</Hint>
      <Button icon="cog-outline" label="Finish setup" onPress={() => open()} />
    </>
  );
  const clash = overlapping(f, getFixtures());
  return (
    <>
      <Hint>{`On OpenClapper's mesh at address ${f.mesh.unicast}${f.mesh.elements > 1 ? `–${f.mesh.unicast + f.mesh.elements - 1}` : ""}.${node.info ? ` Firmware: product ${hex4(node.info.pid)}, version ${hex4(node.info.vid)}, ${node.info.elements} element${node.info.elements === 1 ? "" : "s"}.` : " Run setup again to read its firmware."}`}</Hint>
      {clash && <Banner kind="warn" icon="alert-outline" title={`Addresses overlap “${clash.label}”`} meta="Run setup again to check; if it stays, reset this light and pair it again." />}
      <SideBySide>
        <Button style={{ flex: 1 }} kind="secondary" icon="cog-outline" label="Run setup again" onPress={() => open()} />
        <Button style={{ flex: 1 }} kind="secondary" icon="link-variant" label="Pair again" onPress={() => open(true)} />
      </SideBySide>
    </>
  );
}

const hex4 = (v: number) => v.toString(16).padStart(4, "0");

const STAGE_LABELS: Record<Stage, string> = {
  find: "Find the light",
  invite: "Invite it",
  keys: "Exchange keys",
  confirm: "Confirm both sides",
  data: "Send the network key and address",
  reconnect: "Reconnect through its proxy",
  configure: "Configure it",
};

/** Setup → Lights → a mesh light → Pair: provisions and configures it, with each step shown (#212). */
export function FixtureProvision({ fixtureId, fresh = false }: { fixtureId: string; fresh?: boolean }) {
  const app = useApp();
  const { c } = useTheme();
  const f = useFixtures().find((x) => x.id === fixtureId);
  const [stage, setStage] = useState<Stage | null>(null);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!f) return <PushScreen title="Pair"><Empty icon="lightbulb-off-outline" title="This light is gone" /></PushScreen>;
  const resume = !!f.mesh && !fresh;
  const stages: readonly Stage[] = resume ? STAGES.filter((x) => x === "reconnect" || x === "configure") : STAGES;
  const run = async () => {
    setState("running"); setError(null); setStage(null);
    try {
      await provisionFixture(f, setStage, { fresh });
      setState("done");
      toast(`“${f.label}” is on OpenClapper's mesh`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  };
  const at = stage ? stages.indexOf(stage) : -1;
  return (
    <PushScreen title={resume ? "Set up" : "Pair with OpenClapper"} sub={f.label}
      footer={state === "done"
        ? <Button style={{ flex: 1 }} icon="check" label="Done" onPress={app.pop} />
        : <Button style={{ flex: 1 }} icon={state === "error" ? "refresh" : "link-variant"} label={state === "error" ? "Try again" : resume ? "Set up" : "Pair"} busy={state === "running"} disabled={state === "running"} onPress={() => void run()} />}>
      {!resume && state === "idle" && (
        <Block>
          <Banner kind="warn" icon="alert-outline" title="Sidus Link loses this light" meta="Pairing gives it OpenClapper's keys. To use it with Sidus Link again, reset it and add it there." />
          <Hint>First take it out of Sidus Link: remove it in the app (the light's settings → remove), or reset it on the light itself (see its manual). Then switch it on, keep the phone close, and tap Pair. It takes about half a minute.</Hint>
        </Block>
      )}
      {state !== "idle" && stages.map((s, i) => {
        const done = state === "done" || i < at;
        const now = state === "running" && i === at;
        const failed = state === "error" && i === Math.max(0, at);
        return <ListRow key={s} icon={done ? "check-circle" : failed ? "alert-circle-outline" : now ? "progress-clock" : "circle-outline"} iconColor={failed ? c.danger : undefined} title={STAGE_LABELS[s]} trailing={null} />;
      })}
      {error && <Block><ErrorText>{error}</ErrorText><Hint>Details are in the debug log (Setup → Debug log).</Hint></Block>}
    </PushScreen>
  );
}

/** A reading older than this is shown as stale (the battery is polled every second). */
const STALE_MS = 5000;
/** An Aputure light reports its battery once a minute (#293). */
const MESH_BATTERY_STALE_MS = 75_000;

/** The battery's readout (#210), redrawn every second so a stalled reading shows its age. */
function BatteryReadout({ t, ready, estimated }: { t: Telemetry | null; ready: boolean; /** Time left computed by the phone (PS099S), not reported by the device. */ estimated: boolean }) {
  const s = useStyles();
  const [, tick] = useState(0);
  useEffect(() => { const h = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(h); }, []);
  if (!t || t.battery === undefined) return <Block><Hint>{ready ? "Waiting for the first reading…" : "Readings start once connected."}</Hint></Block>;
  const age = Date.now() - t.at;
  const rows: [string, string][] = [];
  if (t.volts !== undefined) rows.push(["Voltage", `${t.volts.toFixed(2)} V`]);
  if (t.amps !== undefined) rows.push(["Current", `${t.amps.toFixed(2)} A`]);
  if (t.watts !== undefined) rows.push(["Power", `${t.watts < 10 ? t.watts.toFixed(1) : Math.round(t.watts)} W`]);
  if (t.discharging !== undefined) rows.push(["State", t.discharging ? "Feeding a load" : "Idle"]);
  if (t.plugged !== undefined) rows.push(["Power source", t.plugged ? "External supply" : "Battery"]);
  rows.push(["Time left", t.minutesLeft !== undefined ? `about ${formatMinutes(t.minutesLeft)}` : estimated ? "– (no load)" : "–"]);
  return (
    <Block style={{ gap: 8 }}>
      <SectionLabel>Battery</SectionLabel>
      <Text style={s.charge}>{t.battery} %</Text>
      {rows.map(([k, v]) => (
        <View key={k} style={s.reading}><Text style={s.readingLabel}>{k}</Text><Text style={s.readingValue}>{v}</Text></View>
      ))}
      <Hint>{age > (estimated ? STALE_MS : MESH_BATTERY_STALE_MS) ? `No new reading for ${Math.round(age / 1000)} s` : estimated ? "Updated every second. Time left is estimated from the battery's rated energy and the power of the last ~20 s." : "Reported by the light, every minute."}</Hint>
    </Block>
  );
}

/** A frequency or speed step: 11 is Random; Cop car's flash shows 6..10 as cycles. */
function stepLabel(x: number, max: number, cycles?: boolean) {
  if (max === 11 && x >= EFFECT_RANDOM) return "Random";
  return cycles && x > 5 ? `Cycle ${x - 5}` : String(x);
}

/** The running effect's options, as its spec in packages/vocab lists them (#292, #300). */
function EffectOptions({ effect, settings: o, ready, cct, onChange, onTrigger }: {
  effect: EffectId; settings: EffectSettings; ready: boolean; cct: Capabilities["cct"];
  onChange: (next: EffectSettings) => void; onTrigger?: () => void;
}) {
  const [sheet, setSheet] = useState<string | null>(null);
  const spec = EFFECT_OPTIONS[effect];
  if (!spec) return null;
  const mid = cct ? Math.round((cct.min + cct.max) / 200) * 100 : 5600;
  const kelvinSlider = (label: string, value: number, set: (k: number) => void) => cct
    ? <Slider key={label} label={label} value={value} min={cct.min} max={cct.max} step={100} format={(x) => `${x} K`} disabled={!ready} onChange={set} />
    : null;
  return (
    <View style={{ gap: 12 }}>
      {spec.options.map((opt) => {
        switch (opt.key) {
          case "frequency":
          case "speed":
            return <Slider key={opt.key} label={opt.label} value={o[opt.key] ?? 5} min={1} max={opt.max} format={(x) => stepLabel(x, opt.max, opt.cycles)} disabled={!ready}
              onChange={(x) => onChange({ ...o, [opt.key]: x })} />;
          case "kelvin":
            return kelvinSlider(`Effect ${opt.label.toLowerCase()}`, o.kelvin ?? mid, (k) => onChange({ ...o, kelvin: k }));
          case "saturation":
            return <Slider key={opt.key} label={opt.label} value={Math.round((o.saturation ?? 1) * 100)} min={0} max={100} format={(x) => `${x} %`} disabled={!ready}
              onChange={(x) => onChange({ ...o, saturation: x / 100 })} />;
          case "choice":
            // Long lists (Cop car's five colour sets) open a sheet; short ones fit a segmented row.
            if (opt.values.length > 3) return (
              <View key={opt.key}>
                <FieldRow icon="palette-outline" label={opt.label} value={opt.values[o.choice ?? 0] ?? null} onPress={() => ready && setSheet(opt.key)} />
                <OptionSheet visible={sheet === opt.key} title={opt.label} list options={opt.values.map((label, i) => ({ id: String(i), label }))} value={[String(o.choice ?? 0)]}
                  onChange={(ids) => { if (ids[0] !== undefined) onChange({ ...o, choice: Number(ids[0]) }); }} onClose={() => setSheet(null)} />
              </View>
            );
            return (
              <View key={opt.key} style={{ gap: 6 }}>
                <SectionLabel>{opt.label}</SectionLabel>
                <Seg block accessibilityLabel={opt.label} disabled={!ready} value={String(o.choice ?? 0)}
                  onChange={(x) => onChange({ ...o, choice: Number(x) })} options={opt.values.map((label, i) => ({ id: String(i), label }))} />
              </View>
            );
          case "color": {
            const color = o.color ?? { h: 0, s: 1 };
            return (
              <View key={opt.key} style={{ gap: 12 }}>
                <Seg size="lg" block accessibilityLabel="Effect colour" disabled={!ready} value={"kelvin" in color ? "white" : "colour"}
                  onChange={(m) => onChange({ ...o, color: m === "white" ? { kelvin: mid } : { h: 0, s: 1 } })}
                  options={[{ id: "white", label: "White" }, { id: "colour", label: "Colour" }]} />
                {"kelvin" in color ? kelvinSlider("Effect white", color.kelvin, (k) => onChange({ ...o, color: { kelvin: k } })) : (
                  <>
                    <Slider label="Effect hue" value={Math.round(color.h)} min={0} max={360} format={(x) => `${x}°`} disabled={!ready} onChange={(x) => onChange({ ...o, color: { ...color, h: x } })} />
                    <Slider label="Effect saturation" value={Math.round(color.s * 100)} min={0} max={100} format={(x) => `${x} %`} disabled={!ready} onChange={(x) => onChange({ ...o, color: { ...color, s: x / 100 } })} />
                  </>
                )}
              </View>
            );
          }
          default: return null;
        }
      })}
      {onTrigger && <Button kind="secondary" icon="flash" label="Strike now" disabled={!ready} onPress={onTrigger} />}
    </View>
  );
}

/** Send and forget: the hub coalesces, and a refused write is in the debug log. */
const fire = (id: string, cmd: Command) => { void sendToFixture(id, cmd).catch((e) => log("debug", "fixture send dropped", { fixture: id, error: e })); };

/**
 * One fixture: its connection, held open while shown, and the controls its kind has. The lights
 * report nothing back yet, so the controls start from what this phone last set (or the shared
 * start values) and send only what is touched.
 */
export function FixtureControl({ fixtureId }: { fixtureId: string }) {
  const app = useApp();
  const fixtures = useFixtures();
  const f = fixtures.find((x) => x.id === fixtureId);
  useFixtureLease(f ? [f.id] : []);
  const status = useFixtureStatus(fixtureId);
  const kind = f ? fixtureKind(f.kindId) : undefined;
  const [v, setV] = useState<LightState>(() => ({ ...(kind ? startState(kind) : {}), ...status.state }));
  // A light that reports its state (Aputure) moves the controls to what it really shows.
  const reported = JSON.stringify(status.state);
  useEffect(() => { setV((cur) => ({ ...cur, ...status.state })); }, [reported]);
  const [fxSheet, setFxSheet] = useState(false);
  const [mode, setMode] = useState<"cct" | "hsi">(() => (status.state.hsi && !status.state.cct ? "hsi" : "cct"));
  if (!f) return <PushScreen title="Light"><Empty icon="lightbulb-off-outline" title="This light is gone" body="It was deleted, here or on another phone." /></PushScreen>;
  const ready = status.link === "ready";
  const caps = kind?.caps;
  const send = (patch: LightState, cmd: Command) => { setV((cur) => ({ ...cur, ...patch })); fire(f.id, cmd); };
  const cct = v.cct ?? { kelvin: 5600, gm: 0 };
  const col = v.hsi ?? { h: 0, s: 1, i: v.intensity ?? 0.5 };
  const hsiMode = !!caps?.hsi && mode === "hsi";
  const controllable = !!caps && (caps.power || caps.intensity || !!caps.cct);
  return (
    <PushScreen title={f.label} sub={kindName(f.kindId)}
      footer={<Button style={{ flex: 1 }} kind="secondary" icon="pencil-outline" label="Edit" onPress={() => app.push({ name: "fixtureEditor", fixtureId: f.id })} />}>
      <Block>
        <Banner kind={ready ? "ok" : status.link === "failed" ? "warn" : "info"} icon="bluetooth" title={linkLabel(status)} meta={f.address} />
        {kind?.transport === "mesh" ? <MeshPairing f={f} /> : status.link === "failed" && <Hint>The controls for this model are not built yet; pairing and syncing already work.</Hint>}
      </Block>
      {caps && controllable && status.link !== "failed" && (
        <Block style={{ gap: 16 }}>
          {caps.power && (
            <View style={{ gap: 6 }}>
              <SectionLabel>Power</SectionLabel>
              <Seg size="lg" block accessibilityLabel="Power" disabled={!ready} value={v.power === undefined ? null : v.power ? "on" : "off"}
                onChange={(x) => send({ power: x === "on" }, { op: "power", on: x === "on" })} options={[{ id: "off", label: "Off" }, { id: "on", label: "On" }]} />
            </View>
          )}
          {caps.intensity && (
            <Slider label="Intensity" value={Math.round((v.intensity ?? 0.5) * 100)} min={0} max={100} format={(x) => `${x} %`} disabled={!ready}
              onChange={(x) => send({ intensity: x / 100 }, { op: "intensity", value: x / 100 })} />
          )}
          {!!caps.effects?.length && (
            <>
              <FieldRow icon="creation" label="Effect" value={v.effect ? effectName(v.effect) : "Off"} onPress={() => setFxSheet(true)} />
              {v.effect && <Hint>Intensity applies to the effect; choose White or Colour to stop it.</Hint>}
              {v.effect && EFFECT_OPTIONS[v.effect] && (
                <EffectOptions effect={v.effect} settings={effectSettingsOf(v.effect, v.effectSettings)} ready={ready} cct={caps.cct}
                  onChange={(next) => send({ effectSettings: next }, { op: "effect", effect: v.effect!, settings: next })}
                  onTrigger={TRIGGER_EFFECTS.includes(v.effect) ? () => fire(f.id, { op: "trigger" }) : undefined} />
              )}
              <OptionSheet visible={fxSheet} title="Effect" sub="With Sidus Link's default settings" list
                options={[{ id: "off", label: "Off" }, ...caps.effects.map((id) => ({ id, label: effectName(id) }))]} value={[v.effect ?? "off"]}
                onChange={(ids) => { const id = ids[0]; if (!id || !ready) return; const fx = id === "off" ? null : (id as EffectId); send({ effect: fx }, { op: "effect", effect: fx }); }}
                onClose={() => setFxSheet(false)} />
            </>
          )}
          {caps.hsi && caps.cct && (
            <Seg size="lg" block accessibilityLabel="Mode" disabled={!ready} value={mode}
              onChange={(m) => { setMode(m); if (m === "hsi") send({ hsi: col }, { op: "hsi", h: col.h, s: col.s, i: v.intensity ?? col.i }); else send({ cct }, { op: "cct", kelvin: cct.kelvin, gm: cct.gm }); }}
              options={[{ id: "cct", label: "White" }, { id: "hsi", label: "Colour" }]} />
          )}
          {hsiMode && (
            <>
              <Slider label="Hue" value={Math.round(col.h)} min={0} max={360} format={(x) => `${x}°`} disabled={!ready}
                onChange={(x) => send({ hsi: { ...col, h: x } }, { op: "hsi", h: x, s: col.s, i: v.intensity ?? col.i })} />
              <Slider label="Saturation" value={Math.round(col.s * 100)} min={0} max={100} format={(x) => `${x} %`} disabled={!ready}
                onChange={(x) => send({ hsi: { ...col, s: x / 100 } }, { op: "hsi", h: col.h, s: x / 100, i: v.intensity ?? col.i })} />
            </>
          )}
          {caps.cct && !hsiMode && (
            <Slider label="White" value={cct.kelvin} min={caps.cct.min} max={caps.cct.max} step={100} format={(x) => `${x} K`} disabled={!ready}
              onChange={(x) => send({ cct: { ...cct, kelvin: x } }, { op: "cct", kelvin: x, gm: cct.gm })} />
          )}
          {caps.cct?.gm && !hsiMode && (
            <Slider label="Green / magenta" value={cct.gm} min={caps.cct.gm.min} max={caps.cct.gm.max} format={(x) => (x > 0 ? `+${x} M` : x < 0 ? `${-x} G` : "neutral")} disabled={!ready}
              onChange={(x) => send({ cct: { ...cct, gm: x } }, { op: "cct", kelvin: cct.kelvin, gm: x })} />
          )}
          {caps.curves && !hsiMode && (
            <View style={{ gap: 6 }}>
              <SectionLabel>Dimming curve</SectionLabel>
              <Seg size="lg" block accessibilityLabel="Dimming curve" disabled={!ready} value={v.curve ?? null}
                onChange={(x) => send({ curve: x }, { op: "curve", curve: x })} options={CURVE_OPTIONS} />
            </View>
          )}
          <Hint>{kind?.transport === "mesh" ? "The controls follow what the light reports." : "The light does not report its settings yet: the controls show what this phone last set."}</Hint>
        </Block>
      )}
      {caps && caps.telemetry.length > 0 && status.link !== "failed" && <BatteryReadout t={status.telemetry} ready={ready} estimated={!!caps.capacityWh} />}
      {kind && <Block><Hint>{capsLine(kind)}</Hint></Block>}
    </PushScreen>
  );
}

const useStyles = makeStyles((c) => ({
  address: { ...type("caption"), color: c.textDim, ...num },
  charge: { ...type("display", "bold"), color: c.text, ...num },
  reading: { flexDirection: "row", justifyContent: "space-between" },
  readingLabel: { ...type("body"), color: c.textDim },
  readingValue: { ...type("body", "semibold"), color: c.text, ...num },
}));
