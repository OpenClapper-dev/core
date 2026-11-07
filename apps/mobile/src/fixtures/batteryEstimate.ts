/**
 * Time left on a battery (#210): the battery reports charge and current but no time, so the phone
 * estimates it from the rated energy and the power drawn. Power is smoothed, so a one-second dip
 * does not swing the estimate and a light ramping up settles gradually.
 */

/** Smoothing time constant: about the last 20 s of readings count. */
export const SMOOTH_S = 20;
/** Below this the battery is effectively idle (it draws ~0.7 W on its own); no estimate then. */
export const MIN_LOAD_W = 2;

/** Exponential moving average over time, so irregular gaps between readings are weighted right. */
export class PowerSmoother {
  private value: number | null = null;
  private at = 0;

  push(at: number, watts: number): number {
    if (this.value === null || at <= this.at) { this.value = watts; this.at = at; return watts; }
    const k = 1 - Math.exp(-(at - this.at) / 1000 / SMOOTH_S);
    this.value += (watts - this.value) * k;
    this.at = at;
    return this.value;
  }

  reset() { this.value = null; }
}

/** Minutes until empty at this power, or null while idle. Charge in %, energy in Wh. */
export function minutesLeft(chargePct: number, capacityWh: number, watts: number): number | null {
  if (!(watts >= MIN_LOAD_W) || !(chargePct >= 0)) return null;
  return Math.round(((capacityWh * Math.min(100, chargePct)) / 100 / watts) * 60);
}

/** "2 h 05 min", "45 min", "over 24 h". */
export function formatMinutes(m: number): string {
  if (m >= 24 * 60) return "over 24 h";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
