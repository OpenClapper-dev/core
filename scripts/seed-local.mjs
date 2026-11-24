#!/usr/bin/env node
// Fills the LOCAL worker with demo photos: stock pictures from picsum.photos (Unsplash, free to use),
// a project "Stock demo", some of them in collections. The three images of each photo are the same
// picture at 400, 2048 and 4000 px, as a client would make them; EXIF is stated as the camera would
// write it, so each photo gets an angle of view. Ids come from the seed names, so a re-run adds
// nothing twice. Needs `pnpm dev:worker` running and a local user (`make init`).
//   node scripts/seed-local.mjs [count]        (default 30 photos)
import { createHash } from "node:crypto";

const API = process.env.API_URL ?? "http://localhost:8787";
// Production holds real data: this script only ever talks to a local worker.
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API)) { console.error(`Refusing ${API}: local worker only.`); process.exit(1); }
const COUNT = Number(process.argv[2] ?? 30);
const EMAIL = process.env.SEED_EMAIL ?? "dev@localhost", PASSWORD = process.env.SEED_PASSWORD ?? "openclapper-local-dev";

/** A stable UUID (version 5 layout) for a name. */
function uuid(name) {
  const h = createHash("sha1").update(`openclapper-seed:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
// Small seeded PRNG so every run makes the same choices.
let state = 1234567;
const rnd = () => ((state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (list) => list[Math.floor(rnd() * list.length)];

const login = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, client: "mobile" }) });
if (!login.ok) { console.error(`Sign-in as ${EMAIL} failed (${login.status}). Run make init, or set SEED_EMAIL and SEED_PASSWORD.`); process.exit(1); }
const { token } = await login.json();
const auth = { Authorization: `Bearer ${token}` };

async function api(method, path, body) {
  const res = await fetch(API + path, { method, headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
async function image(seed, w, h) {
  const res = await fetch(`https://picsum.photos/seed/${seed}/${w}/${h}.jpg`);
  if (!res.ok) throw new Error(`picsum ${seed}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const project = uuid("project:stock");
await api("PUT", `/api/projects/${project}`, { name: "Stock demo" });
const collections = ["Harbour at dawn", "Old brewery", "Rooftops"].map((name, i) => ({ id: uuid(`collection:${name}`), name, color: i * 3 + 1 }));
for (const c of collections) await api("PUT", `/api/files/${c.id}`, { type: "collection", project_id: project, name: c.name, body: { color: c.color, order: "time" } });

const CAMERAS = [{ make: "FUJIFILM", model: "X-T5", f: [23, 33, 56] , crop: 1.5 }, { make: "Google", model: "Pixel 9", f: [6.9], crop: 3.5 }, { make: "Canon", model: "EOS R5", f: [24, 35, 50, 85], crop: 1 }];
console.log(`Seeding ${COUNT} photos into ${API}`);
let made = 0;
for (let n = 0; n < COUNT; n++) {
  const id = uuid(`photo:${n}`), seed = `oc-${n}`;
  const upright = n % 5 === 2;
  const [w, h] = upright ? [3000, 4000] : [4000, 3000];
  const cam = pick(CAMERAS), focal = pick(cam.f);
  const when = new Date(Date.UTC(2026, 10, 1 + Math.floor(n / 6), 7 + (n % 6) * 2, n * 7 % 60));
  const container = n % 4 === 0 ? null : collections[n % collections.length].id;
  const res = await fetch(`${API}/api/photos/${id}`, { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({
    project_id: project, origin: n % 3 ? "import" : "capture", media_type: "image/jpeg", width: w, height: h, name: `IMG_${String(1000 + n)}`, container,
    taken_at: when.toISOString(), exif: { Make: cam.make, Model: cam.model, FocalLength: focal, FocalLengthIn35mmFilm: Math.round(focal * cam.crop) }, readout: { make: cam.make, model: cam.model },
  }) });
  if (!res.ok) throw new Error(`photo ${n}: ${res.status} ${await res.text()}`);
  if (res.status === 201) made++;
  for (const [part, edge] of [["thumbnail", 400], ["preview", 2048], ["original", 4000]]) {
    const k = edge / Math.max(w, h);
    const up = await fetch(`${API}/api/photos/${id}/${part}`, { method: "PUT", headers: { ...auth, "content-type": "application/octet-stream" }, body: await image(seed, Math.round(w * k), Math.round(h * k)) });
    if (!up.ok) throw new Error(`photo ${n} ${part}: ${up.status} ${await up.text()}`);
  }
  process.stdout.write(".");
}
console.log(`\n${made} new photo(s) in "Stock demo" (the others were there already).`);
