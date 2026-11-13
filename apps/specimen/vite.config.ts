import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

// The design system's specimen app: every foundation card, component group and kit in Light and Dark.
// Local only; nothing deploys it (docs/rewrite/README.md, design track D3).
export default defineConfig({ plugins: [preact()], build: { outDir: "dist", emptyOutDir: true } });
