import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/**
 * Two projects, one runner (docs/testing.md): `unit` runs plain functions in Node, `routes` runs
 * requests through the Worker's own fetch/scheduled inside workerd, against a local D1 and R2 that
 * every test file gets fresh (test/routes/setup.ts applies the migrations).
 */
export default defineConfig(async () => {
  const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
  // wrangler.jsonc serves the Studio's build as assets; the route tests only call /api/*, but the
  // directory has to exist. Gitignored (dist/), so nothing is committed.
  mkdirSync(here("../studio/dist"), { recursive: true });
  const migrations = await readD1Migrations(here("migrations"));
  return {
    test: {
      projects: [
        { test: { name: "unit", include: ["test/unit/**/*.test.ts"], environment: "node" } },
        {
          // Vite does not read wrangler.jsonc's `alias`: the same auth seam, mapped here.
          resolve: { alias: { "@openclapper/auth-provider": here("src/authn/first-party.ts") } },
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: {
                // The lowest iteration count Workers accept keeps signing in fast (password.ts clamps to it).
                bindings: { TEST_MIGRATIONS: migrations, PBKDF2_ITERATIONS: "10000" },
              },
            }),
          ],
          test: { name: "routes", include: ["test/routes/**/*.test.ts"], setupFiles: ["./test/routes/setup.ts"] },
        },
      ],
    },
  };
});
