import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  root: "ui",
  plugins: [preact()],
  build: { outDir: "../dist", emptyOutDir: true, sourcemap: false },
  // Local dev: the admin Worker (`pnpm -C apps/admin dev:worker`, ADMIN_DEV_BYPASS on) on :8788.
  server: { port: 5174, strictPort: true, proxy: { "/api": "http://localhost:8788" } },
});
