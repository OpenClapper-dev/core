import { fixtureKind, type FixtureLive } from "@openclapper/vocab";
import { cx, Icon } from "@openclapper/ui";
import type { ServerFixture } from "./api";

/**
 * Where a device's power comes from and how much is left (#294): a light or battery with its own
 * cells (the MC, the PS099S), a light on an assigned battery (a NEEWER COB on a PS099S), or a socket.
 * Readings come from the phone proxy; none while it is off.
 */
export interface Power {
  source: "own" | "battery" | "socket";
  /** 0..100, or null without a reading. */
  pct: number | null;
  minutesLeft?: number;
  /** The battery a light runs on (source "battery"). */
  battery?: ServerFixture;
}

export const isBattery = (f: ServerFixture) => { const k = fixtureKind(f.kind_id); return !!k && !k.caps.power && k.caps.telemetry.includes("battery"); };
/** A light that runs on a socket or a separate battery: it can be given one. */
export const takesBattery = (f: ServerFixture) => { const k = fixtureKind(f.kind_id); return !!k && k.caps.power && !k.caps.telemetry.includes("battery"); };

export function powerOf(f: ServerFixture, fixtures: readonly ServerFixture[], live: (id: string) => FixtureLive | undefined): Power {
  const reading = (id: string) => {
    const t = live(id)?.telemetry;
    return { pct: t?.battery ?? null, ...(t?.minutesLeft !== undefined ? { minutesLeft: t.minutesLeft } : {}) };
  };
  if (!takesBattery(f)) return { source: "own", ...reading(f.id) };
  const battery = f.powered_by ? fixtures.find((x) => x.id === f.powered_by) : undefined;
  return battery ? { source: "battery", battery, ...reading(battery.id) } : { source: "socket", pct: null };
}

export const minutesText = (m: number) => (m >= 24 * 60 ? "over 24 h" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`);

const levelIcon = (pct: number) => (pct >= 95 ? "battery" : pct < 10 ? "battery-alert-variant-outline" : `battery-${Math.max(10, Math.floor(pct / 10) * 10)}`);

/** A compact battery reading: icon, percentage, low and critical in warning colours; a plug for a socket. */
export function BatteryChip({ power, compact }: { power: Power; compact?: boolean }) {
  if (power.source === "socket") return <span class="power-chip" title="On a socket"><Icon name="power-plug-outline" />{!compact && "Socket"}</span>;
  if (power.pct === null) return <span class="power-chip is-unknown" title="No reading: the proxy is off or the device not connected"><Icon name="battery-unknown" />{!compact && "–"}</span>;
  const via = power.source === "battery" && power.battery ? ` on ${power.battery.label}` : "";
  return (
    <span class={cx("power-chip", power.pct < 10 ? "is-critical" : power.pct < 25 && "is-low")} title={`${power.pct} %${via}${power.minutesLeft !== undefined ? ` · about ${minutesText(power.minutesLeft)} left` : ""}`}>
      <Icon name={levelIcon(power.pct)} /><span class="num">{power.pct} %</span>
    </span>
  );
}
