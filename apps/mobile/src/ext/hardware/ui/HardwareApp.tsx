import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { controlGroups, modelName, modelOf, type FixtureLive } from "@openclapper/ext-hardware";
import { useLinkStatus } from "../../../link";
import { useBack } from "../../../shell/back";
import { persisted } from "../../../store";
import { Block, Button, Empty, Header, Hint, makeStyles, Screen, SectionLabel, Seg, toast, Toggle, type } from "../../../ui";
import { syncDevices, useDevices, type HardwareDevice } from "../library";
import { command, hello, reconnectAll, startProxy, stopProxy, useHardware } from "../proxy";
import { AddDevice } from "./AddDevice";
import { ControlView, useHeld } from "./Controls";
import { DeviceScreen } from "./Device";
import { KeyBackup } from "./KeyBackup";
import { BatteryBar, LinkMark, SleepButton, TypeTag, chargeOf, linkOf } from "./parts";

/** How the list shows, kept on this device. */
const view = persisted<"table" | "cards">("hardware.view.v1", "table");

/**
 * Hardware on the phone and tablet (docs/features/hardware.md, U6 "On the device"): the account's lights, batteries,
 * cameras and transmitters as a table (a tap opens a device) or as cards with their controls; the proxy switch
 * (this phone holds the connections, for itself, the Studio and other phones); adding a device; Reconnect all; the
 * mesh key backup.
 */
export function HardwareApp({ active }: { active: boolean }) {
  const devices = useDevices();
  const { state, running } = useHardware();
  const link = useLinkStatus();
  const v = view.use();
  const [page, setPage] = useState<string | null>(null);
  useBack(page ? () => setPage(null) : null, active);
  useEffect(() => { void syncDevices(); hello(); }, []);
  const live = (id: string): FixtureLive | undefined => state?.devices.find((x) => x.id === id);

  const open = page ? devices.find((d) => d.id === page) : undefined;
  if (page === "add") return <AddDevice back={() => setPage(null)} opened={(id) => setPage(id)} />;
  if (page === "keys") return <KeyBackup back={() => setPage(null)} />;
  if (open) return <DeviceScreen d={open} back={() => setPage(null)} />;

  return (
    <Screen header={<Header title="Hardware" sub={`${devices.length} device${devices.length === 1 ? "" : "s"}`} actions={[{ icon: "plus", label: "Add a device", onPress: () => setPage("add") }, { icon: "lock", label: "Key backup", onPress: () => setPage("keys") }]} />}>
      <Block>
        <Toggle label="This device holds the connections" value={running} onChange={(on) => (on ? startProxy() : stopProxy())}
          meta={running ? `Proxy on · ${link.studios ? `${link.studios} Studio tab${link.studios === 1 ? "" : "s"} attached` : "no Studio open"} · the screen stays on` : state?.proxy ? `Another device holds them: ${state.phone.name || "a device"}` : "Off: nothing is connected"} />
        {running && <KeepAwake />}
        {running && !link.open && <Hint>Not connected to the server: only this device can control the devices now.</Hint>}
      </Block>
      <Block>
        <Seg block accessibilityLabel="View" value={v} onChange={(x) => view.set(x)} options={[{ id: "table", label: "Table" }, { id: "cards", label: "Cards" }]} />
      </Block>
      {!devices.length && <Block><Empty icon="light-fixture" title="No devices yet" body="Add lights, a battery, a camera or a transmitter." /><Button icon="plus" label="Add a device" onPress={() => setPage("add")} /></Block>}
      {v === "table"
        ? devices.map((d) => <TableRow key={d.id} d={d} all={devices} live={live} proxy={!!state?.proxy} onPress={() => setPage(d.id)} />)
        : devices.map((d) => <Card key={d.id} d={d} all={devices} live={live} proxy={!!state?.proxy} onOpen={() => setPage(d.id)} />)}
      {running && devices.some((d) => !d.body.asleep) && (
        <Block>
          <Button kind="secondary" icon="refresh" label="Reconnect all" onPress={() => { reconnectAll(); toast("Reconnecting, one device at a time"); }} />
          <Hint>Drops every connection and connects again. The lights keep their state.</Hint>
        </Block>
      )}
    </Screen>
  );

}

function TableRow({ d, all, live, proxy, onPress }: { d: HardwareDevice; all: HardwareDevice[]; live: (id: string) => FixtureLive | undefined; proxy: boolean; onPress: () => void }) {
  const s = useStyles();
  const m = modelOf(d.body.model)!;
  const l = linkOf(d, live(d.id), proxy);
  const ch = chargeOf(d, all, live);
  return (
    <View style={s.row}>
      <Pressable onPress={onPress} style={({ pressed }) => [s.rowOpen, pressed && s.pressed, d.body.asleep && s.asleep]} accessibilityRole="button" accessibilityLabel={`${d.name}, ${l.label}`}>
        <View style={s.rowMain}><Text style={s.name} numberOfLines={1}>{d.name}</Text><TypeTag kind={m.type} /></View>
        <View style={s.rowSide}><LinkMark tone={l.tone} label={l.label} />{ch.charge !== undefined || ch.from ? <BatteryBar charge={ch.charge} minutes={ch.minutes} /> : null}</View>
      </Pressable>
      <SleepButton d={d} />
    </View>
  );
}

/** A device across the width with its first controls ready to use (U6, cards). */
export function Card({ d, all, live, proxy, onOpen }: { d: HardwareDevice; all: HardwareDevice[]; live: (id: string) => FixtureLive | undefined; proxy: boolean; onOpen: () => void }) {
  const s = useStyles();
  const m = modelOf(d.body.model)!;
  const l = live(d.id);
  const link = linkOf(d, l, proxy);
  const ch = chargeOf(d, all, live);
  const held = useHeld();
  const first = controlGroups(m, "phone")[0]?.controls.filter((c) => c.kind === "switch" || c.kind === "range" || c.kind === "button").slice(0, 4) ?? [];
  return (
    <Block>
      <View style={s.cardHead}>
        <Pressable onPress={onOpen} style={[s.rowOpen, d.body.asleep && s.asleep]} accessibilityRole="button" accessibilityLabel={`Open ${d.name}, ${link.label}`}>
          <View style={s.rowMain}><Text style={s.name}>{d.name}</Text><TypeTag kind={m.type} /></View>
          <Text style={s.meta}>{modelName(m)}</Text>
          <View style={s.rowSide}><LinkMark tone={link.tone} label={link.label} />{ch.charge !== undefined || ch.from ? <BatteryBar charge={ch.charge} minutes={ch.minutes} /> : null}</View>
        </Pressable>
        <SleepButton d={d} />
      </View>
      {/* Asleep: the controls stay out of the way until it is woken. */}
      {!d.body.asleep && first.map((c) => <ControlView key={c.id} m={m} c={c} live={l} held={held} disabled={l?.link !== "ready"} send={(cmd) => command(d.id, cmd)} />)}
      {!d.body.asleep && m.feeds.length > 0 && <Button kind="secondary" icon="video" label="Show the picture" onPress={onOpen} />}
      {!d.body.asleep && !first.length && !m.feeds.length && <SectionLabel>{m.states.length ? "Open for its readings" : "Open"}</SectionLabel>}
    </Block>
  );
}

function KeepAwake() { useKeepAwake(); return null; }

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 16, paddingRight: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  rowOpen: { flex: 1, gap: 4, paddingVertical: 4 },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  pressed: { backgroundColor: c.borderSubtle },
  asleep: { opacity: 0.6 },
  rowMain: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowSide: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 },
  name: { ...type("label"), color: c.text, flexShrink: 1 },
  meta: { ...type("caption"), color: c.textDim },
}));
