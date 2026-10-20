import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Runs before each test file; every file has its own D1, so this sets up a fresh schema (idempotent).
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
