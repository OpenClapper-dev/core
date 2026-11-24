import type { ComponentChildren } from "preact";
import { AppIcon } from "../os/AppIcon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** A connection's state in colour with its words (U6: state is shown in colour, not as text alone). */
export type Tone = "ok" | "warn" | "danger" | "off";

export function ConnectionMark({ tone, label, className }: { tone: Tone; label: string; className?: string }) {
  return <span className={cx("oc-conn", `oc-conn--${tone}`, className)}><i aria-hidden="true" />{label}</span>;
}

/** A battery's charge (0–100) as a bar with its number, and the time left when known; a dash when unknown. */
export function BatteryBar({ charge, minutes, label = "Charge", className }: { charge: number | null | undefined; minutes?: number | null; label?: string; className?: string }) {
  if (charge == null) return <span className={cx("oc-batt", "oc-batt--unknown", className)} aria-label={`${label} unknown`}><b>—</b></span>;
  const c = Math.max(0, Math.min(100, charge));
  const left = minutes == null ? "" : minutes >= 60 ? ` · ${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, "0")}` : ` · ${Math.round(minutes)} min`;
  return (
    <span className={cx("oc-batt", c <= 15 ? "oc-batt--red" : c <= 30 && "oc-batt--amber", className)} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c)}>
      <i style={{ width: `${c}%` }} /><b>{Math.round(c)} %{left}</b>
    </span>
  );
}

/**
 * One device across the full width (U6, Devices as cards): who it is with its type's colour, its connection and
 * battery, and beside that what it exposes, ready to use (`children`). `off`: asleep or not reachable.
 */
export function DeviceCard({ icon, color, name, sub, connection, battery, off, selected, onOpen, actions, children, className }: {
  icon: IconName; color: number; name: ComponentChildren; sub?: ComponentChildren; connection: ComponentChildren; battery?: ComponentChildren;
  off?: boolean; selected?: boolean; onOpen?: () => void; actions?: ComponentChildren; children?: ComponentChildren; className?: string;
}) {
  return (
    <section className={cx("oc-device", off && "is-off", selected && "is-current", className)} style={{ "--c": `var(--cat-${color})` }}>
      <div className="oc-device__who" onClick={onOpen} role={onOpen ? "button" : undefined} tabIndex={onOpen ? 0 : undefined} onKeyDown={(e) => { if (onOpen && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}>
        <AppIcon glyph={icon} color={color} size={32} />
        <span className="oc-device__name"><strong>{name}</strong>{sub && <small>{sub}</small>}</span>
        {connection}
        {battery}
      </div>
      <div className="oc-device__what">{children}</div>
      {actions && <div className="oc-device__actions">{actions}</div>}
    </section>
  );
}
