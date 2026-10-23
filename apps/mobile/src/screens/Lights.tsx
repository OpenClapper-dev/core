import { useEffect, useRef, useState } from "react";
import { Text } from "react-native";
import * as Crypto from "expo-crypto";
import { fixtureKind, fixtureKindName, FIXTURE_LABEL_MAX, type FixtureKind } from "@openclapper/vocab";
import { useApp } from "../appState";
import { adapterState, scan, type Seen } from "../ble/link";
import { askBluetooth } from "../ble/permissions";
import { linkLabel, useFixtureLease, useFixtureStatus } from "../fixtures/hub";
import { deleteFixture, getFixtures, saveFixture, syncFixtures, useFixtures } from "../fixtures/library";
import { ALL_KINDS, suggestKinds } from "../fixtures/registry";
import type { Fixture } from "../fixtures/types";
import { log } from "../log";
import { Banner, Block, Button, confirm, Empty, ErrorText, FieldRow, Hint, Input, ListRow, makeStyles, num, PushScreen, SectionLabel, SideBySide, toast, type } from "../ui";
import { OptionSheet } from "../components/OptionSheet";

const kindIcon = (k: FixtureKind | undefined) => (k && !k.caps.power ? "battery-high" : "lightbulb-outline");
const kindName = (id: string) => { const k = fixtureKind(id); return k ? fixtureKindName(k) : `Unknown kind (${id})`; };

/** What a kind can be asked to do, in words. */
function capsLine(k: FixtureKind): string {
  const c = k.caps;
  return [
    c.intensity && "intensity",
    c.cct && `white ${c.cct.min}–${c.cct.max} K${c.cct.gm ? " + green/magenta" : ""}`,
    c.hsi && "colour",
    c.curves && "dimming curves",
    c.telemetry.length > 0 && "charge, volts, watts, time left",
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

/** One fixture: its connection, and (from #209 on) its controls. */
export function FixtureControl({ fixtureId }: { fixtureId: string }) {
  const app = useApp();
  const fixtures = useFixtures();
  const f = fixtures.find((x) => x.id === fixtureId);
  useFixtureLease(f ? [f.id] : []);
  const status = useFixtureStatus(fixtureId);
  if (!f) return <PushScreen title="Light"><Empty icon="lightbulb-off-outline" title="This light is gone" body="It was deleted, here or on another phone." /></PushScreen>;
  const kind = fixtureKind(f.kindId);
  return (
    <PushScreen title={f.label} sub={kindName(f.kindId)}
      footer={<Button style={{ flex: 1 }} kind="secondary" icon="pencil-outline" label="Edit" onPress={() => app.push({ name: "fixtureEditor", fixtureId: f.id })} />}>
      <Block>
        <Banner kind={status.link === "ready" ? "ok" : status.link === "failed" ? "warn" : "info"} icon="bluetooth" title={linkLabel(status)} meta={f.address} />
        {kind && <Hint>{capsLine(kind)}</Hint>}
        {status.link === "failed" && <Hint>The controls for this model are not built yet; pairing and syncing already work.</Hint>}
      </Block>
    </PushScreen>
  );
}

const useStyles = makeStyles((c) => ({
  address: { ...type("caption"), color: c.textDim, ...num },
}));
