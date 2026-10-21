#!/usr/bin/env node
// The CSP of the Studio and the admin board (public/_headers, issue #224) allows the one inline script
// of each index.html (theme before first paint) by its SHA-256. Editing that script changes the hash:
//
//   node scripts/csp-hash.mjs            prints the hash of each app's inline scripts
//   node scripts/csp-hash.mjs --check    after `vite build`: fails when a built index.html has an inline
//                                        script whose hash is not in the built _headers (pnpm build runs it)
//
// The hash covers the script's text exactly as it stands between <script> and </script>.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const apps = [
  { name: "studio", html: "apps/studio/index.html", dist: "apps/studio/dist" },
  { name: "admin", html: "apps/admin/ui/index.html", dist: "apps/admin/dist" },
];

const inlineScripts = (html) =>
  [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter((m) => !/\ssrc=/.test(m[1] ?? "")).map((m) => m[2]);
const hash = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

let failed = false;
for (const app of apps) {
  const htmlPath = join(root, check ? join(app.dist, "index.html") : app.html);
  if (!existsSync(htmlPath)) { console.error(`csp-hash: ${htmlPath} missing (run vite build first)`); failed = true; continue; }
  const hashes = inlineScripts(readFileSync(htmlPath, "utf8")).map(hash);
  if (!check) { console.log(`${app.name}: ${hashes.join(" ") || "(no inline script)"}`); continue; }
  const headers = readFileSync(join(root, app.dist, "_headers"), "utf8");
  for (const h of hashes) {
    if (!headers.includes(h)) {
      console.error(`csp-hash: ${app.name}: inline script ${h} is not allowed by _headers; update script-src (node scripts/csp-hash.mjs)`);
      failed = true;
    }
  }
}
if (failed) process.exit(1);
