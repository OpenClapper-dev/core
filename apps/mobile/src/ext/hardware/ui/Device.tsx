import { useState } from "react";
import { View } from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { PROVISION_STAGE_LABELS, controlGroups, formatValue, modelName, modelOf, stateValue, type FixtureLive } from "@openclapper/ext-hardware";
import { canCall } from "../../../api";
import { Banner, Block, Button, confirm, Header, Hint, Input, ListRow, Row, Screen, SectionLabel, Sheet, SheetList, toast } from "../../../ui";
import { removeDevice, renameDevice, setAsleep, setPower, useDevices, type HardwareDevice } from "../library";
import { command, request, useHardware } from "../proxy";
import { ControlView, useHeld } from "./Controls";
import { BatteryBar, LinkMark, TypeTag, chargeOf, linkOf } from "./parts";
import { Picture } from "./Picture";

/**
 * One device's screen on the phone (docs/features/hardware.md, U6): what its model exposes, ready to use (through
 * this phone when it is the proxy, else through the phone that is), its state, its power source or what it powers,
 * sleep and wake, pairing a mesh light again, rename and remove. A transmitter's picture shows here: it works on the
 * phone only.
 */
export function DeviceScreen({ d, back }: { d: HardwareDevice; back: () => void }) {
  const m = modelOf(d.body.model)!;
  const all = useDevices();
  const { state, provision } = useHardware();
  const live = (id: string): FixtureLive | undefined => state?.devices.find((x) => x.id === id);
  const l = live(d.id);
  const link = linkOf(d, l, !!state?.proxy);
  const ready = l?.link === "ready";
  const held = useHeld();
  const [name, setName] = useState<string | null>(null);
  const [power, setPowerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const online = canCall();
  const charge = chargeOf(d, all, live);
  const batteries = all.filter((x) => modelOf(x.body.model)?.powers);
  const powers = all.filter((x) => x.body.poweredBy === d.id);
  const prov = provision?.device === d.id ? provision : null;

  const sleep = () => { setBusy(true); setAsleep(d, !d.body.asleep).then(() => { request({ type: "sync" }); toast(d.body.asleep ? `${d.name} woken` : `${d.name} asleep`); }, () => toast("Could not change sleep: the server is not reachable", "danger")).finally(() => setBusy(false)); };
  const rename = () => { const to = name?.trim(); setName(null); if (to && to !== d.name) void renameDevice(d, to).then(() => request({ type: "sync" }), () => toast("Not renamed: the server is not reachable", "danger")); };
  const remove = async () => {
    const mesh = m.transport === "mesh" && d.body.mesh;
    if (!(await confirm({ title: `Remove “${d.name}”?`, body: mesh ? "It goes to the recycle bin. The light keeps the phone's network keys until it is reset on the light itself." : "It goes to the recycle bin.", confirmLabel: "Remove", danger: true }))) return;
    try { await removeDevice(d); request({ type: "sync" }); back(); } catch { toast("Not removed: the server is not reachable", "danger"); }
  };
  const pickPower = (battery: string | null) => { setPowerOpen(false); void setPower(d.id, battery).then(() => request({ type: "sync" }), () => toast("Not changed: the server is not reachable", "danger")); };

  return (
    <Screen header={<Header title={d.name} sub={modelName(m)} onBack={back} />}>
      <Block>
        <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}><TypeTag kind={m.type} /><LinkMark tone={link.tone} label={link.label} /></View>
        {charge.charge !== undefined || charge.from ? <Row label={charge.from ? `Battery (${charge.from})` : "Battery"}><BatteryBar charge={charge.charge} minutes={charge.minutes} /></Row> : null}
        {!state?.proxy && m.transport !== "wifi" && <Hint>No phone holds the connections: switch the proxy on in Hardware, on this phone or another.</Hint>}
        {m.type === "camera" && !ready && <Hint>First connection: the camera shows a 6-digit PIN in its Bluetooth menu; type it into the pairing dialog on the proxy phone. Bluetooth must be on in the camera's Setup menu.</Hint>}
      </Block>

      {m.feeds.map((f) => <Block key={f.id}><SectionLabel>{f.label}</SectionLabel><PictureHost /></Block>)}

      {m.transport === "mesh" && (
        <Block>
          <SectionLabel>Pairing</SectionLabel>
          {prov && <Banner kind={prov.phase === "error" ? "danger" : prov.phase === "done" ? "ok" : "info"} title={prov.phase === "error" ? prov.error ?? "Pairing failed" : prov.phase === "done" ? "Paired" : prov.stage ? PROVISION_STAGE_LABELS[prov.stage] : "Starting…"} />}
          {!d.body.mesh && <Hint>Not paired with this phone's network yet. Remove the light from Sidus Link first, or reset it.</Hint>}
          <Button kind={d.body.mesh ? "secondary" : "primary"} icon="bluetooth" label={d.body.mesh ? "Run setup again" : "Pair with OpenClapper"} disabled={!state?.proxy || !online || prov?.phase === "running"} onPress={() => request({ type: "provision", device: d.id })} />
          {d.body.mesh && <Button kind="secondary" icon="refresh" label="Pair again (after a reset)" disabled={!state?.proxy || !online || prov?.phase === "running"} onPress={() => request({ type: "provision", device: d.id, fresh: true })} />}
        </Block>
      )}

      {controlGroups(m, "phone").map((g) => (
        <Block key={g.group}>
          <SectionLabel>{g.group}</SectionLabel>
          {g.controls.map((c) => <ControlView key={c.id} m={m} c={c} live={l} held={held} disabled={!ready} send={(cmd) => command(d.id, cmd)} />)}
        </Block>
      ))}

      {m.states.length > 0 && (
        <Block>
          <SectionLabel>Reported</SectionLabel>
          {m.states.map((s) => <ListRow key={s.id} title={s.label} meta={formatValue(s.format, stateValue(s, l))} />)}
        </Block>
      )}
      {m.type === "camera" && l?.telemetry?.camera && (
        <Block>
          <SectionLabel>{`Reported by the camera (${Object.keys(l.telemetry.camera.params).length})`}</SectionLabel>
          <Hint>{Object.entries(l.telemetry.camera.params).map(([k, v]) => `${k}: ${typeof v === "string" ? v : v.join(", ")}`).join("\n") || "Nothing yet"}</Hint>
          <SectionLabel>Incoming log</SectionLabel>
          <Hint>{l.telemetry.camera.log.join("\n") || "—"}</Hint>
        </Block>
      )}

      <Block>
        <SectionLabel>Power</SectionLabel>
        {m.takesBattery && <ListRow icon="plug" title="Runs on" meta={d.body.poweredBy ? all.find((x) => x.id === d.body.poweredBy)?.name ?? "A battery that is gone (socket)" : "A socket"} onPress={online ? () => setPowerOpen(true) : undefined} />}
        {m.powers && <ListRow icon="battery" title="Powers" meta={powers.length ? powers.map((x) => x.name).join(", ") : "Nothing"} />}
        {!m.takesBattery && !m.powers && <Hint>{m.states.some((s) => s.id === "battery") ? "Its own battery." : "Its own power."}</Hint>}
      </Block>

      <Block>
        <SectionLabel>Device</SectionLabel>
        <Row label="Name"><Input value={name ?? d.name} onChangeText={setName} onEndEditing={rename} onSubmitEditing={rename} maxLength={120} editable={online} /></Row>
        <Button kind="secondary" icon={d.body.asleep ? "sun" : "moon"} label={d.body.asleep ? "Wake" : "Sleep"} busy={busy} disabled={!online} onPress={sleep} />
        <Hint>An asleep device gets no connection attempts until it is woken.</Hint>
        <Button kind="danger" icon="trash" label="Remove" disabled={!online} onPress={() => void remove()} />
        <Hint>{m.pairing}</Hint>
      </Block>

      <Sheet visible={power} title="Runs on" onClose={() => setPowerOpen(false)}>
        <SheetList>
          <ListRow icon="plug" title="A socket" selected={!d.body.poweredBy} onPress={() => pickPower(null)} />
          {batteries.map((b) => <ListRow key={b.id} icon="battery" title={b.name} meta={all.find((x) => x.body.poweredBy === b.id && x.id !== d.id)?.name ? `Now powers ${all.find((x) => x.body.poweredBy === b.id && x.id !== d.id)!.name}` : undefined} selected={d.body.poweredBy === b.id} onPress={() => pickPower(b.id)} />)}
        </SheetList>
      </Sheet>
    </Screen>
  );
}

/** The picture keeps the screen on while it shows. */
function PictureHost() {
  useKeepAwake();
  return <Picture />;
}
