import { Text, View } from "react-native";
import { modelOf, TYPE_LABELS, type FixtureLive, type HardwareType } from "@openclapper/ext-hardware";
import { canCall } from "../../../api";
import { catColor, IconButton, makeStyles, num, toast, type, useTheme, type IconName } from "../../../ui";
import { setAsleep, type HardwareDevice } from "../library";

/** The type's glyph and categorical colour (U6: a coloured tag per type). */
export const TYPE_LOOK: Record<HardwareType, { icon: IconName; color: number }> = { light: { icon: "light-fixture", color: 3 }, battery: { icon: "battery", color: 4 }, camera: { icon: "video", color: 1 }, transmitter: { icon: "antenna", color: 8 } };

/** How a device's connection reads, and its tone (U6: state in colour, not as text alone). */
export function linkOf(d: HardwareDevice, live: FixtureLive | undefined, proxy: boolean): { label: string; tone: "ok" | "warn" | "danger" | "off" } {
  if (d.body.asleep) return { label: "Asleep · not connecting", tone: "off" };  if (modelOf(d.body.model)?.transport === "wifi") return { label: "On the device's Wi-Fi", tone: "off" };
  if (!proxy) return { label: "No proxy", tone: "off" };
  switch (live?.link) {
    case "ready": return { label: "Connected", tone: "ok" };
    case "silent": return { label: "In the mesh, not answering (off?)", tone: "warn" };
    case "waiting": return { label: "Waiting to connect", tone: "warn" };
    case "absent": return { label: "Not in range", tone: "off" };
    case "connecting": return { label: "Connecting…", tone: "warn" };
    case "retrying": return { label: `Reconnecting (try ${live.attempt + 1})`, tone: "warn" };
    case "failed": return { label: live.error ?? "Cannot connect", tone: "danger" };
    default: return { label: "Not connected", tone: "off" };
  }
}

export function TypeTag({ kind }: { kind: HardwareType }) {
  const s = useStyles();
  const { c } = useTheme();
  const col = catColor(c, TYPE_LOOK[kind].color);
  return <View style={[s.tag, { borderColor: col }]}><Text style={[s.tagText, { color: col }]}>{TYPE_LABELS[kind].label}</Text></View>;
}

export function LinkMark({ tone, label }: { tone: "ok" | "warn" | "danger" | "off"; label: string }) {
  const s = useStyles();
  const { c } = useTheme();
  const col = tone === "ok" ? c.ok : tone === "warn" ? c.warn : tone === "danger" ? c.danger : c.textDisabled;
  return <View style={s.mark}><View style={[s.dot, { backgroundColor: col }]} /><Text style={s.markText} numberOfLines={1}>{label}</Text></View>;
}

/** A charge as a bar with its number; nothing when unknown. */
export function BatteryBar({ charge, minutes }: { charge: number | undefined; minutes?: number }) {
  const s = useStyles();
  const { c } = useTheme();
  if (charge === undefined) return <Text style={s.dim}>—</Text>;
  const col = charge <= 15 ? c.danger : charge <= 30 ? c.warn : c.ok;
  return (
    <View style={s.bat}>
      <View style={s.batTrack}><View style={[s.batFill, { width: `${Math.max(0, Math.min(100, charge))}%`, backgroundColor: col }]} /></View>
      <Text style={s.batText}>{`${Math.round(charge)} %${minutes !== undefined ? ` · ${minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, "0")}` : `${Math.round(minutes)} min`}` : ""}`}</Text>
    </View>
  );
}

/** The charge to show for a device: its own, or that of the battery it runs on. */
export function chargeOf(d: HardwareDevice, all: HardwareDevice[], live: (id: string) => FixtureLive | undefined): { charge?: number; minutes?: number; from?: string } {
  const own = live(d.id)?.telemetry;
  if (own?.battery !== undefined) return { charge: own.battery, minutes: own.minutesLeft };
  const bat = d.body.poweredBy ? all.find((x) => x.id === d.body.poweredBy) : undefined;
  const t = bat ? live(bat.id)?.telemetry : undefined;
  return bat ? { charge: t?.battery, minutes: t?.minutesLeft, from: bat.name } : {};
}

/** Sleep or wake, from any of the phone's views: at once, also offline (library.ts setAsleep). */
export function toggleSleep(d: HardwareDevice) {
  const asleep = !d.body.asleep;
  setAsleep(d, asleep);
  toast(`${d.name} ${asleep ? "asleep" : "woken"}${canCall() ? "" : " · saved to the server when it answers"}`, "neutral");
}

/** The compact Sleep / Wake button of a table row or a card. */
export function SleepButton({ d }: { d: HardwareDevice }) {
  return <IconButton icon={d.body.asleep ? "sun" : "moon"} label={d.body.asleep ? `Wake ${d.name}` : `Sleep ${d.name}`} onPress={() => toggleSleep(d)} />;
}

const useStyles = makeStyles((c) => ({
  tag: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 6, alignSelf: "flex-start" },
  tagText: { ...type("caption") },
  mark: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  markText: { ...type("caption"), color: c.textDim, flexShrink: 1 },
  dim: { ...type("caption"), color: c.textDisabled },
  bat: { flexDirection: "row", alignItems: "center", gap: 6 },
  batTrack: { width: 44, height: 8, borderRadius: 4, backgroundColor: c.borderSubtle, overflow: "hidden" },
  batFill: { height: 8 },
  batText: { ...type("caption"), color: c.textDim, ...num },
}));
