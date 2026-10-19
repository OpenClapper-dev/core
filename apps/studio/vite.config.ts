import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { execFileSync } from "node:child_process";
import { version } from "../../package.json";

// The product version (root package.json, docs/releasing.md) and the commit this bundle is built from.
const commit = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "dev"; } })();
const build = { __FIELDER_VERSION__: JSON.stringify(version), __FIELDER_COMMIT__: JSON.stringify(commit) };

export default defineConfig({
  plugins: [preact()],
  define: build,
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    // Local dev: proxy API calls to `wrangler dev` (apps/worker; sign in as dev@localhost, make init).
    // ws: the live layout preview socket (/api/preview/socket).
    proxy: { "/api": { target: "http://localhost:8787", ws: true }, "/health": "http://localhost:8787" },
  },
});
