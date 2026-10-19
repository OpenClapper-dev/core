import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { execFileSync } from "node:child_process";
import { version } from "../../package.json";

// The product version (root package.json, docs/releasing.md) and the commit this bundle is built from.
const commit = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "dev"; } })();
const build = { __FIELDER_VERSION__: JSON.stringify(version), __FIELDER_COMMIT__: JSON.stringify(commit) };

export default defineConfig({
  root: "ui",
  plugins: [preact()],
  define: build,
  build: { outDir: "../dist", emptyOutDir: true, sourcemap: false },
  // Local dev: the admin Worker (`pnpm -C apps/admin dev:worker`, ADMIN_DEV_BYPASS on) on :8788.
  server: { port: 5174, strictPort: true, proxy: { "/api": "http://localhost:8788" } },
});
