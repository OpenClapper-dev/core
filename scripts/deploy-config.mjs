#!/usr/bin/env node
// Writes the deploy configs of both Workers (apps/worker and apps/admin wrangler.deploy.jsonc,
// gitignored) from the tracked local-dev configs plus one deployment's settings. The tracked configs
// name no Cloudflare account, database or Access app, so the same repository deploys anywhere.
//
//   node scripts/deploy-config.mjs [--provision]
//
// Settings come from the environment only, never from a file: a deployment sets them as GitHub
// variables and secrets (the Deploy workflow exports them), or exports the same names itself
// (docs/self-hosting.md). An empty variable counts as unset.
//   CLOUDFLARE_ACCOUNT_ID   required
//   D1_DATABASE_ID          required, unless --provision finds or creates the database by name
//   D1_DATABASE_NAME        default openclapper-db
//   D1_LOCATION             optional location hint when --provision creates the database (weur, enam…)
//   R2_BUCKET               default openclapper-media (--provision creates it when missing)
//   APP_WORKER_NAME         default openclapper-api
//   ADMIN_WORKER_NAME       default openclapper-admin
//   APP_DOMAIN              optional: a custom domain for the app Worker (a zone in the same account)
//   ADMIN_DOMAIN            optional: a custom domain for the admin plane
//   ACCESS_TEAM_DOMAIN      your Zero Trust team domain (the admin plane needs it)
//   ADMIN_ACCESS_AUD        the admin Access application's AUD; without it the admin plane refuses every request
//   PBKDF2_ITERATIONS       optional, see docs/known-issues.md
//   AUTH_PROVIDER           optional: a module to use instead of the first-party sign-in (the auth seam)
//   INSTANCE_LABEL          optional: a name such as "staging", shown by the Studio and the admin board so a
//                           second instance is never mistaken for production; empty for production
//   CF_ANALYTICS_TOKEN      optional secret, set with `wrangler secret put` after the deploy (the workflow does); the
//                           admin config only gets CLOUDFLARE_ACCOUNT_ID, APP_WORKER_NAME and R2_BUCKET as vars for it
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const provision = process.argv.includes("--provision");

// GitHub passes an unset variable as "", so empty means unset.
const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
const setting = (k, fallback) => env[k] ?? fallback;
const fail = (msg) => { console.error(`deploy-config: ${msg}`); process.exit(1); };

/** JSON with // and /* comments (wrangler.jsonc); strings are kept as they are. */
function parseJsonc(text) {
  let out = "", i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') { let j = i + 1; while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1; out += text.slice(i, j + 1); i = j + 1; }
    else if (text.startsWith("//", i)) i = text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i);
    else if (text.startsWith("/*", i)) i = text.indexOf("*/", i) + 2;
    else { out += c; i++; }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const accountId = setting("CLOUDFLARE_ACCOUNT_ID") ?? fail("CLOUDFLARE_ACCOUNT_ID is not set");
const dbName = setting("D1_DATABASE_NAME", "openclapper-db");
const bucket = setting("R2_BUCKET", "openclapper-media");
const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { cwd: join(root, "apps/worker"), env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId }, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

let dbId = setting("D1_DATABASE_ID");
if (provision) {
  if (!dbId) {
    const found = JSON.parse(wrangler("d1", "list", "--json")).find((d) => d.name === dbName);
    if (found) dbId = found.uuid;
    else {
      console.log(`deploy-config: creating D1 database ${dbName}`);
      wrangler("d1", "create", dbName, ...(env.D1_LOCATION ? ["--location", env.D1_LOCATION] : []));
      dbId = JSON.parse(wrangler("d1", "list", "--json")).find((d) => d.name === dbName)?.uuid;
    }
  }
  const buckets = wrangler("r2", "bucket", "list");
  if (!new RegExp(`name:\\s+${bucket}\\s*$`, "m").test(buckets)) {
    console.log(`deploy-config: creating R2 bucket ${bucket}`);
    wrangler("r2", "bucket", "create", bucket);
  }
}
if (!dbId) fail("D1_DATABASE_ID is not set (or run with --provision)");

let commit = "unknown";
try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); } catch { /* not a git checkout */ }

function write(app, edit) {
  const dir = join(root, "apps", app);
  const cfg = parseJsonc(readFileSync(join(dir, "wrangler.jsonc"), "utf8"));
  cfg.account_id = accountId;
  cfg.d1_databases = cfg.d1_databases.map((d) => ({ ...d, database_name: dbName, database_id: dbId }));
  cfg.r2_buckets = cfg.r2_buckets.map((b) => ({ ...b, bucket_name: bucket }));
  cfg.vars = { ...cfg.vars, INSTANCE_LABEL: setting("INSTANCE_LABEL", ""), ...(env.PBKDF2_ITERATIONS ? { PBKDF2_ITERATIONS: env.PBKDF2_ITERATIONS } : {}) };
  // The commit this deploy runs (BUILD in packages/service-kit), so a running Worker can say which one.
  cfg.define = { ...cfg.define, __OPENCLAPPER_COMMIT__: JSON.stringify(commit) };
  edit(cfg, dir);
  const out = join(dir, "wrangler.deploy.jsonc");
  writeFileSync(out, `// Generated by scripts/deploy-config.mjs from wrangler.jsonc; do not edit, do not commit.\n${JSON.stringify(cfg, null, 2)}\n`);
  console.log(`deploy-config: wrote ${relative(root, out)} (${cfg.name})`);
}

// A custom domain's zone must be in the same Cloudflare account; wrangler attaches it on deploy,
// and the workers.dev URL keeps working beside it.
const domain = (cfg, name) => { if (env[name]) cfg.routes = [{ pattern: env[name], custom_domain: true }]; };

write("worker", (cfg, dir) => {
  cfg.name = setting("APP_WORKER_NAME", "openclapper-api");
  domain(cfg, "APP_DOMAIN");
  if (env.AUTH_PROVIDER) {
    const abs = isAbsolute(env.AUTH_PROVIDER) ? env.AUTH_PROVIDER : join(root, env.AUTH_PROVIDER);
    if (!existsSync(abs)) fail(`AUTH_PROVIDER ${env.AUTH_PROVIDER} does not exist`);
    cfg.alias = { ...cfg.alias, "@openclapper/auth-provider": `./${relative(dir, abs)}` };
  }
});
write("admin", (cfg) => {
  cfg.name = setting("ADMIN_WORKER_NAME", "openclapper-admin");
  domain(cfg, "ADMIN_DOMAIN");
  cfg.vars.ACCESS_TEAM_DOMAIN = setting("ACCESS_TEAM_DOMAIN", "");
  cfg.vars.ACCESS_AUD = setting("ADMIN_ACCESS_AUD", "");
  // For the Cloudflare overlay (apps/admin/src/cloudflare.ts): which account, script and bucket are this instance's.
  cfg.vars.CLOUDFLARE_ACCOUNT_ID = accountId;
  cfg.vars.APP_WORKER_NAME = setting("APP_WORKER_NAME", "openclapper-api");
  cfg.vars.R2_BUCKET = bucket;
  if (!cfg.vars.ACCESS_AUD || !cfg.vars.ACCESS_TEAM_DOMAIN) console.log("deploy-config: ACCESS_TEAM_DOMAIN or ADMIN_ACCESS_AUD missing: the admin plane will refuse every request (docs/self-hosting.md)");
});
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `d1_database_id=${dbId}\n`, { flag: "a" });
