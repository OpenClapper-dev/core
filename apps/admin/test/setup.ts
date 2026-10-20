import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// The app's migrations (apps/worker owns the schema); every test file has its own D1.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
