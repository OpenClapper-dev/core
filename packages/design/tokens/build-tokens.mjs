// Generates src/tokens.css (web custom properties) and src/tokens.ts (the React Native object) from
// tokens.json, the single source both clients read. `--check` fails when the generated files are stale,
// so CI catches a hand edit or a forgotten rebuild. Usage: node tokens/build-tokens.mjs [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Builds both outputs from the parsed tokens.json; pure so the test can call it. */
export function build(src) {
  const prim = src.color.primitive, sem = src.color.semantic;
  const RE = /\{([\w-]+)\.([\w-]+)\}/g;
  const ref = (v) => String(v).replace(RE, (_m, a, b) => `var(--${a}-${b})`);
  const hex = (v) => String(v).replace(RE, (_m, a, b) => prim[a][b]);
  const decl = (obj, f, pre = "") => Object.entries(obj).map(([k, v]) => `  --${pre}${k}: ${f(v)};`).join("\n");
  const px = (v) => `${v}px`, ms = (v) => (typeof v === "number" ? `${v}ms` : v), id = (v) => v;
  const theme = (t) => `${decl(sem[t], ref)}\n${decl(src.shadow[t], id, "shadow-")}\n  color-scheme: ${t};`;
  const root = [
    Object.entries(prim).map(([n, ramp]) => decl(ramp, id, `${n}-`)).join("\n"),
    decl(src.color.fixed, id), decl(src.color.env, id, "env-").replace("--env-on-env", "--on-env"),
    `  --font-sans: ${src.font.sans};\n  --font-mono: ${src.font.mono};`,
    decl(src["font-size"], px, "font-size-"), decl(src.leading, id, "leading-"), decl(src.weight, id, "weight-"),
    decl(src.space, px, "space-"), decl(src.size, px), decl(src.radius, px, "radius-"), decl(src.border, px),
    decl(src.motion, ms), decl(src.z, id, "z-"),
  ].join("\n");
  const css = "/* GENERATED from tokens/tokens.json by tokens/build-tokens.mjs. Do not edit. */\n" +
    `:root {\n${root}\n${theme("light")}\n}\n` +
    "/* Auto: follow the OS. The explicit scopes below come later, so they win. */\n" +
    `@media (prefers-color-scheme: dark) {\n:root {\n${theme("dark")}\n}\n}\n` +
    `[data-theme="light"] {\n${theme("light")}\n}\n` +
    `[data-theme="dark"] {\n${theme("dark")}\n}\n` +
    "@media (prefers-reduced-motion: reduce) {\n:root {\n  --dur-fast: 0ms;\n  --dur: 0ms;\n  --dur-slow: 0ms;\n}\n}\n";
  const camel = (s) => s.replace(/-(\w)/g, (_m, c) => c.toUpperCase());
  const map = (o, f) => Object.fromEntries(Object.entries(o).map(([k, v]) => [camel(k), f ? f(v) : v]));
  const rn = {
    light: { ...map(sem.light, hex), shadow: map(src.shadow.light) },
    dark: { ...map(sem.dark, hex), shadow: map(src.shadow.dark) },
    FIXED: map(src.color.fixed), ENV: map(src.color.env),
    FONT: { sans: src.font["rn-sans"], mono: src.font["rn-mono"] },
    FONT_SIZE: map(src["font-size"]), LEADING: map(src.leading), WEIGHT: map(src.weight),
    SPACE: map(src.space), SIZE: map(src.size), RADIUS: map(src.radius), BORDER: map(src.border),
    MOTION: map(src.motion), Z: map(src.z),
  };
  const ts = "// GENERATED from tokens/tokens.json by tokens/build-tokens.mjs. Do not edit.\n" +
    "// The phone's token object: TOKENS.light / TOKENS.dark for themed colours, FIXED over photos and the camera.\n" +
    `export const TOKENS = ${JSON.stringify(rn, null, 2)} as const;\n\nexport type ThemeName = "light" | "dark";\n`;
  return { css, ts };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] === self) {
  const at = (p) => fileURLToPath(new URL(p, import.meta.url));
  const out = build(JSON.parse(readFileSync(at("./tokens.json"), "utf8")));
  const files = [[at("../src/tokens.css"), out.css], [at("../src/tokens.ts"), out.ts]];
  if (process.argv.includes("--check")) {
    const stale = files.filter(([p, s]) => { try { return readFileSync(p, "utf8") !== s; } catch { return true; } });
    if (stale.length) { console.error(`stale: ${stale.map(([p]) => p).join(", ")}; run node tokens/build-tokens.mjs`); process.exit(1); }
  } else for (const [p, s] of files) writeFileSync(p, s);
}
