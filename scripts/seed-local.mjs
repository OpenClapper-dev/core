#!/usr/bin/env node
// Fills the LOCAL worker with demo shots: stock photos from picsum.photos (Unsplash, free to use),
// two projects, a few locations and random tags (camera fields too), some shots as sequences and
// some without a position. Ids are derived from
// the seed names, so a re-run uploads nothing twice. Needs `pnpm dev:worker` running.
//   node scripts/seed-local.mjs [count]        (default 40 shots)
import { createHash } from "node:crypto";

const API = process.env.API_URL ?? "http://localhost:8787";
// Production holds real data: this script only ever talks to a local worker.
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) { console.error(`Refusing ${API}: local worker only.`); process.exit(1); }
const COUNT = Number(process.argv[2] ?? 40);

/** A stable UUID (version 5 layout) for a name. */
function uuid(name) {
  const h = createHash("sha1").update(`openclapper-seed:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
// Small seeded PRNG so every run makes the same tags.
let state = 1234567;
const rnd = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (list) => list[Math.floor(rnd() * list.length)];

async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const projects = [{ id: uuid("project:a"), name: "Stock demo" }, { id: uuid("project:b"), name: "Stock demo B" }];
const locations = ["Spreeufer", "Tempelhofer Feld", "Alexanderplatz", "Teufelsberg", "Hafen Neukölln", "Plattenbau Marzahn"].map((name) => ({ id: uuid(`location:${name}`), name }));
const NAMES = ["Wide over the water", "Alley at dusk", "Rooftop pan", "Underpass", "Market corner", "Empty platform", "Courtyard", "Bridge from below", "Forest edge", "Car park top deck", "Shop window", "Stairwell"];
const LIGHT = ["dawn", "day", "dusk", "night"];
const WEATHER = ["sunny", "partly_cloudy", "cloudy", "rainy", "foggy"];
const STATES = ["unreviewed", "unreviewed", "approved", "archived"];
const SIZES = ["ews", "ws", "mws", "ms", "mcu", "cu", "ecu"];
const SUPPORTS = ["static", "handheld", "steadicam", "gimbal", "dolly", "slider", "crane", "drone", "vehicle"];
const MOVES = ["pan", "tilt", "push_in", "pull_out", "tracking", "pedestal", "orbit", "zoom"];
const RIG = { preset_name: "Alexa Mini LF · Open Gate", camera_id: "alexa_mini_lf", format_id: "open_gate", sensor_width_mm: 36.7, sensor_height_mm: 25.54, speedbooster_factor: 1 };

console.log(`Seeding ${COUNT} shots into ${API}`);
for (const p of projects) await api("PUT", `/api/projects/${p.id}`, { name: p.name, notes: "Demo data from scripts/seed-local.mjs" });
for (const l of locations) await api("PUT", `/api/locations/${l.id}`, { name: l.name });

const images = new Map();
async function image(seed) {
  if (!images.has(seed)) {
    const res = await fetch(`https://picsum.photos/seed/${seed}/1200/900.jpg`);
    if (!res.ok) throw new Error(`picsum ${seed}: ${res.status}`);
    images.set(seed, await res.blob());
  }
  return images.get(seed);
}

let created = 0;
for (let n = 0; n < COUNT; n++) {
  const id = uuid(`shot:${n}`);
  const photos = n % 7 === 3 ? 3 : 1; // every seventh shot is a sequence
  const located = n % 9 !== 5; // every ninth shot was captured with GPS off
  const lat = 52.45 + rnd() * 0.12, lon = 13.3 + rnd() * 0.2;
  const at = Date.UTC(2026, 8, 1 + (n % 30), 6 + Math.floor(rnd() * 14), Math.floor(rnd() * 60));
  const light = LIGHT.filter(() => rnd() < 0.35);
  const meta = {
    id, project_id: projects[n % 3 === 2 ? 1 : 0].id,
    name: rnd() < 0.85 ? `${pick(NAMES)} ${n + 1}` : null,
    location_id: rnd() < 0.8 ? pick(locations).id : null,
    int_ext: pick(["int", "ext", "ext", null]),
    light, artificial: rnd() < 0.25, weather: rnd() < 0.7 ? pick(WEATHER) : null,
    shot_size: rnd() < 0.7 ? pick(SIZES) : null, camera_support: rnd() < 0.6 ? pick(SUPPORTS) : null, movement: MOVES.filter(() => rnd() < 0.2),
    photos: Array.from({ length: photos }, (_, k) => {
      const lens = pick([18, 25, 35, 50, 85]);
      return {
        id: uuid(`photo:${n}:${k}`), ordinal: k, timestamp: new Date(at + k * 20_000).toISOString(),
        lat: located ? lat + k * 0.0002 : null, lon: located ? lon : null, gps_accuracy_m: located ? 3 + Math.round(rnd() * 20) : null, lens_mm: lens, width: 1200, height: 900,
        framing: { ...RIG, frame: { width_fraction: 0.92, height_fraction: 0.86 }, full_frame_equivalent_mm: lens, rig_orientation: "landscape" },
        device: { phone_model: "Seed script" },
      };
    }),
  };
  const form = new FormData();
  form.set("metadata", JSON.stringify(meta));
  for (const [k, ph] of meta.photos.entries()) form.set(`photo.${ph.id}`, await image(`openclapper-${n}-${k}`), "photo.jpg");
  const res = await fetch(`${API}/api/shots`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload ${n}: ${res.status} ${await res.text()}`);
  if (res.status === 201) {
    created++;
    // Review states are set after upload (uploads always start unreviewed).
    const st = pick(STATES);
    if (st !== "unreviewed") await api("PATCH", `/api/shots/${id}`, { state: st });
  }
  process.stdout.write(res.status === 201 ? "+" : "=");
}
console.log(`\n${created} new, ${COUNT - created} already there. Projects: ${projects.map((p) => p.name).join(", ")}.`);
