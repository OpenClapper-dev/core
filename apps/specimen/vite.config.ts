import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// The design system's specimen app: every foundation card, component group and kit in Light and Dark.
// Local only; nothing deploys it (docs/rewrite/README.md, design track D3).
// Its own port (scripts/ports.mjs), never another.
export default defineConfig({ plugins: [preact()], build: { outDir: "dist", emptyOutDir: true }, server: { port: 5175, strictPort: true } });
