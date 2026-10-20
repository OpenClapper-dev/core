import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/** The admin plane's route tests (docs/testing.md): its Worker in workerd, on the app's schema. */
export default defineConfig(async () => {
  const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
  // wrangler.jsonc serves the board's build as assets; the tests only call /api/*, but the directory has to exist.
  mkdirSync(here("dist"), { recursive: true });
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations(here("../worker/migrations")), PBKDF2_ITERATIONS: "10000" } },
      }),
    ],
    test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
  };
});
