#!/usr/bin/env node
// The build rule of docs/rewrite/08-extensions.md: core code never imports extension code. Extension code
// is a package `@openclapper/ext-*` or a folder `src/ext/`; the only core file allowed to import it is a
// client's composition root, `src/extensions.ts`. Runs in `pnpm lint`.
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["apps/worker/src", "apps/studio/src", "apps/mobile/src", "apps/mobile/App.tsx", "apps/admin/src", "packages/model/src", "packages/design/src", "packages/fov-math/src", "packages/service-kit/src"];
const IMPORT = /(?:import|export)\s[^"'`;]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;
const isExt = (spec, file) => spec.startsWith("@openclapper/ext-") || (spec.startsWith(".") && path.relative(process.cwd(), path.resolve(path.dirname(file), spec)).split(path.sep).includes("ext"));

const bad = [];
const walk = (p) => {
  if (!fs.existsSync(p)) return;
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    if (path.basename(p) === "ext" || path.basename(p) === "node_modules") return;
    for (const f of fs.readdirSync(p)) walk(path.join(p, f));
    return;
  }
  if (!/\.(ts|tsx|mts|js|mjs)$/.test(p) || /(^|\/)src\/extensions\.ts$/.test(p)) return;
  const src = fs.readFileSync(p, "utf8");
  for (const m of src.matchAll(IMPORT)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec && isExt(spec, p)) bad.push(`${p}: imports ${spec}`);
  }
};
for (const r of ROOTS) walk(r);
if (bad.length) {
  console.error("Core code imports extension code (docs/rewrite/08-extensions.md); only src/extensions.ts may:\n  " + bad.join("\n  "));
  process.exit(1);
}
console.log("check-extensions: core imports no extension code");
