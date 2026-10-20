/** What the board's pages share: the stat tile, the section frame, number formats. */
import type { ComponentChildren } from "preact";
import { Icon } from "@openclapper/ui";

export const bytes = (n: number) => (n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);
export const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "—");
export const num = (n: number) => n.toLocaleString();

export function Tile({ label, value, sub }: { label: string; value: ComponentChildren; sub: ComponentChildren }) {
  return <div class="admin__tile"><span class="admin__tilelabel">{label}</span><span class="admin__tilevalue num">{value}</span><span class="meta">{sub}</span></div>;
}

export function Section({ icon, title, action, children }: { icon: string; title: string; action?: ComponentChildren; children: ComponentChildren }) {
  return <section class="admin__sec"><h2><Icon name={icon} />{title}{action && <span class="admin__secact">{action}</span>}</h2>{children}</section>;
}
