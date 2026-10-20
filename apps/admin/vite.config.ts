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
    root: "ui",
    plugins: [preact(), watchUi],
    define: build,
    build: { outDir: "../dist", emptyOutDir: true, sourcemap: false },
    // Local dev: the admin Worker (`pnpm -C apps/admin dev:worker`, ADMIN_DEV_BYPASS on) on :8788.
    server: { port: 5174, strictPort: true, proxy: { "/api": "http://localhost:8788" } },
  };
});
