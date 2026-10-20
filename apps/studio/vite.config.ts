import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { version } from "../../package.json";

// The product version (root package.json, docs/releasing.md) and the commit this bundle is built from.
const commit = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "dev"; } })();
const build = { __OPENCLAPPER_VERSION__: JSON.stringify(version), __OPENCLAPPER_COMMIT__: JSON.stringify(commit) };

// @openclapper/ui lives outside this root, where Vite watches single files; a git branch switch replaces
// them and those watches are lost until a restart. Watching the folder survives that.
const uiSrc = fileURLToPath(new URL("../../packages/ui/src", import.meta.url));
const watchUi = { name: "openclapper-watch-ui", configureServer(server: { watcher: { add(path: string): unknown } }) { server.watcher.add(uiSrc); } };

export default defineConfig(({ command }) => {
  // Which icon set index.html links (public/icons/<set>/): green on the dev server, the real one in builds.
  process.env.VITE_ICON_SET = command === "build" ? "prod" : "dev";
  return {
    plugins: [preact(), watchUi],
    define: build,
    build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
    server: {
      // Local dev: proxy API calls to `wrangler dev` (apps/worker; sign in as dev@localhost, make init).
      // ws: the live layout preview socket (/api/preview/socket).
      proxy: { "/api": { target: "http://localhost:8787", ws: true }, "/health": "http://localhost:8787" },
    },
  };
});
