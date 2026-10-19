/** Hourly forecast from Open-Meteo (free, no key, CORS enabled, about 16 days ahead). */
export interface HourForecast { time: Date; tempC: number; precipProb: number | null; cloudPct: number; code: number }

/** WMO weather code -> short text. */
export function weatherText(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "—";
}

const FORECAST_DAYS = 16;
const cache = new Map<string, Promise<HourForecast[] | null>>();

/**
 * Hours covering [start, end) at a position, or null when the range is outside the forecast
 * horizon (past days or more than ~16 days ahead). Times are requested in UTC so they map to
 * instants regardless of the viewer's time zone.
 */
export function fetchForecast(lat: number, lon: number, start: Date, end: Date): Promise<HourForecast[] | null> {
  const now = Date.now();
  if (end.getTime() < now - 3_600_000 || start.getTime() > now + FORECAST_DAYS * 86_400_000) return Promise.resolve(null);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${start.toISOString()},${end.toISOString()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
    + `&hourly=temperature_2m,precipitation_probability,cloud_cover,weather_code&timezone=GMT&start_date=${day(start)}&end_date=${day(new Date(end.getTime() - 1))}`;
  const p = fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`forecast HTTP ${r.status}`))))
    .then((j: { hourly?: { time: string[]; temperature_2m: number[]; precipitation_probability: (number | null)[]; cloud_cover: number[]; weather_code: number[] } }) => {
      const h = j.hourly;
      if (!h) return null;
      return h.time
        .map((t, i) => ({ time: new Date(`${t}:00Z`), tempC: h.temperature_2m[i], precipProb: h.precipitation_probability[i] ?? null, cloudPct: h.cloud_cover[i], code: h.weather_code[i] }))
        .filter((x) => x.time >= start && x.time < end);
    })
    .catch(() => { cache.delete(key); return null; });
  cache.set(key, p);
  return p;
}
