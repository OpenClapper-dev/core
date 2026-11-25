import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { version } from "../../package.json";

// The product version (root package.json, docs/releasing.md) and the commit this bundle is built from.
const commit = (() => { try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim(); } catch { return "dev"; } })();
const build = { __OPENCLAPPER_VERSION__: JSON.stringify(version), __OPENCLAPPER_COMMIT__: JSON.stringify(commit) };

// The shared packages (design system, model, extensions, fov-math) live outside this root, where Vite watches single
// files; a git branch switch replaces them and those watches are lost until a restart. Watching every package's
// folder survives that (#426: an extension package's new export was not seen).
const packagesDir = fileURLToPath(new URL("../../packages", import.meta.url));
const shared = readdirSync(packagesDir).map((p) => `${packagesDir}/${p}/src`).filter((p) => existsSync(p));
const watchShared = { name: "openclapper-watch-shared", configureServer(server: { watcher: { add(path: string): unknown } }) { for (const p of shared) server.watcher.add(p); } };

export default defineConfig(({ command }) => {
  // Which icon set index.html links (public/icons/<set>/): green on the dev server; in builds the
  // instance's own set when it has one (INSTANCE_LABEL=staging: clay), else the production one.
  const instance = process.env.INSTANCE_LABEL ?? "";
  const ownSet = /^[a-z0-9-]+$/.test(instance) && existsSync(fileURLToPath(new URL(`./public/icons/${instance}`, import.meta.url)));
  process.env.VITE_ICON_SET = command !== "build" ? "dev" : ownSet ? instance : "prod";
  return {
    plugins: [preact(), watchShared],
    define: build,
    build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
    server: {
      // Its own port (scripts/ports.mjs), never another: taken, it fails instead of moving onto the admin board's.
      port: 5173,
      strictPort: true,
      // Local dev: proxy API calls to `wrangler dev` (apps/worker; sign in as dev@localhost, make init).
      // ws: the phone link's socket.
      proxy: { "/api": { target: "http://localhost:8787", ws: true }, "/health": "http://localhost:8787" },
    },
  };
});
