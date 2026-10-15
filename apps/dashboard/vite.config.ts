import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
  server: {
    // Local dev: proxy API calls to `wrangler dev` (apps/worker, ACCESS_DEV_BYPASS on).
    // ws: the live layout preview socket (/api/preview/socket).
    proxy: { "/api": { target: "http://localhost:8787", ws: true }, "/health": "http://localhost:8787" },
  },
});
