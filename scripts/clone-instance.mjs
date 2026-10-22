#!/usr/bin/env node
// Replaces one instance with a 1:1 copy of another (staging ← production): the R2 bucket first, then
// the D1 database, so a finished run is consistent. Whatever the target held is gone afterwards; the
// source is only read. Run by the Clone workflow (.github/workflows/clone.yml) in the target's GitHub
// environment; like every script here it reads the environment only (docs/self-hosting.md).
//
//   node scripts/clone-instance.mjs
//
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   the deploy token (D1 edit) and account
//   D1_DATABASE_NAME, R2_BUCKET                    the target, replaced
//   SOURCE_D1_DATABASE_NAME, SOURCE_R2_BUCKET      the source, read
//   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY         an R2 token: Object Read & Write on the target bucket
//   SOURCE_R2_ACCESS_KEY_ID, SOURCE_R2_SECRET_ACCESS_KEY   an R2 token: Object Read only on the source bucket
//   D1_LOCATION                                    optional location hint for the recreated database (weur…)
//   CONFIRM                                        must equal D1_DATABASE_NAME: a typed confirmation
//
// D1 is replaced by deleting the target database and creating it again by name (a clean wipe, no
// dropping of tables in foreign-key order), then importing the source's export. The new database has a
// new id: the target's deploy finds it by name (no D1_DATABASE_ID), and must run right after this,
// since its Workers are bound to the deleted id until then. Sessions are not cloned.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Splits SQL into statements at top-level semicolons: not inside '…' (with '' escapes), "…", `…`, […],
 * comments, or a trigger's BEGIN … END body.
 */
export function splitStatements(sql) {
  const out = [];
  let cur = "", i = 0;
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  while (i < sql.length) {
    const c = sql[i];
    const close = c === "'" ? "'" : c === '"' ? '"' : c === "`" ? "`" : c === "[" ? "]" : null;
    if (close) {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) break;
        if (sql[j] === close) { if (close === "'" && sql[j + 1] === "'") { j += 2; continue; } break; }
        j++;
      }
      cur += sql.slice(i, j + 1); i = j + 1;
    } else if (sql.startsWith("--", i)) {
      const j = sql.indexOf("\n", i); i = j < 0 ? sql.length : j;
    } else if (sql.startsWith("/*", i)) {
      const j = sql.indexOf("*/", i + 2); i = j < 0 ? sql.length : j + 2;
    } else if (c === ";") {
      cur += c; i++;
      // A trigger's body has statements of its own: it ends only at END;
      if (/^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(cur) && !/\bEND\s*;$/i.test(cur)) continue;
      push();
    } else { cur += c; i++; }
  }
  push();
  return out;
}

/**
 * Makes a D1 export importable into an empty database. The export lists tables in the database's own
 * order, where a table that gained a reference later (ALTER TABLE … REFERENCES workspaces) comes before
 * the table it references, and SQLite refuses rows for a parent table that does not exist yet, deferred
 * or not. So: pragmas, every table, the rows, then indexes, triggers and views; foreign keys deferred to
 * the end of the import (as migrations 0005 and 0026 do). Refuses a dump that would recreate a
 * D1-internal table (`_cf_…`): those exist in every database.
 */
export function prepareDump(sql) {
  const statements = splitStatements(sql);
  if (statements.some((st) => /^CREATE TABLE (IF NOT EXISTS )?"?_cf_/i.test(st))) throw new Error("the export contains a D1-internal _cf_ table; importing it would fail");
  const rank = (st) => (/^PRAGMA\b/i.test(st) ? 0 : /^CREATE\s+(VIRTUAL\s+)?TABLE\b/i.test(st) ? 1 : /^CREATE\b/i.test(st) ? 3 : 2);
  const ordered = statements.map((st, n) => ({ st, n, r: rank(st) })).sort((a, b) => a.r - b.r || a.n - b.n).map((x) => x.st);
  if (!ordered.some((st) => /^PRAGMA\s+defer_foreign_keys\s*=\s*(TRUE|ON|1)\s*;?$/i.test(st))) ordered.unshift("PRAGMA defer_foreign_keys = TRUE;");
  return `${ordered.map((st) => (st.endsWith(";") ? st : `${st};`)).join("\n")}\n`;
}

/** The names the clone works on, checked before anything is touched; throws with every problem at once. */
export function plan(env) {
  const need = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "D1_DATABASE_NAME", "R2_BUCKET", "SOURCE_D1_DATABASE_NAME", "SOURCE_R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "SOURCE_R2_ACCESS_KEY_ID", "SOURCE_R2_SECRET_ACCESS_KEY"];
  const problems = need.filter((k) => !env[k]).map((k) => `${k} is not set`);
  if (env.D1_DATABASE_NAME && env.D1_DATABASE_NAME === env.SOURCE_D1_DATABASE_NAME) problems.push("source and target are the same D1 database");
  if (env.R2_BUCKET && env.R2_BUCKET === env.SOURCE_R2_BUCKET) problems.push("source and target are the same R2 bucket");
  if (env.D1_DATABASE_NAME && env.CONFIRM !== env.D1_DATABASE_NAME) problems.push(`CONFIRM must be the target database's name, ${env.D1_DATABASE_NAME}`);
  if (problems.length) throw new Error(problems.join("; "));
  return {
    account: env.CLOUDFLARE_ACCOUNT_ID,
    db: { from: env.SOURCE_D1_DATABASE_NAME, to: env.D1_DATABASE_NAME, location: env.D1_LOCATION || "" },
    bucket: { from: env.SOURCE_R2_BUCKET, to: env.R2_BUCKET },
  };
}

function main() {
  // GitHub passes an unset variable as "", so empty means unset (as in deploy-config.mjs).
  const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
  let p;
  try { p = plan(env); } catch (e) { console.error(`clone-instance: ${e.message}`); process.exit(1); }
  const work = mkdtempSync(join(tmpdir(), "openclapper-clone-"));
  const run = (cmd, args, extra = {}) => execFileSync(cmd, args, { stdio: "inherit", ...extra });
  // wrangler from a folder without a wrangler config: database names must resolve through the account,
  // never through apps/worker/wrangler.jsonc (whose DB entry has the local placeholder id).
  const bin = join(root, "node_modules", ".bin", "wrangler");
  const wrangler = (...args) => run(bin, args, { cwd: work });
  const databases = () => JSON.parse(execFileSync(bin, ["d1", "list", "--json"], { cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })).map((d) => d.name);
  try {
    console.log(`clone-instance: ${p.bucket.from} → ${p.bucket.to}, ${p.db.from} → ${p.db.to} (the target is replaced)`);

    // R2: a sync with deletion, compared by checksum (a re-render keeps its key and often its size), with
    // the custom metadata the Worker writes (workspace_id, shot_id, kind). Two remotes, two tokens: the
    // source's can only read.
    const endpoint = `https://${p.account}.r2.cloudflarestorage.com`;
    const remote = (name, id, secret) => ({ [`RCLONE_CONFIG_${name}_TYPE`]: "s3", [`RCLONE_CONFIG_${name}_PROVIDER`]: "Cloudflare", [`RCLONE_CONFIG_${name}_ENDPOINT`]: endpoint, [`RCLONE_CONFIG_${name}_ACCESS_KEY_ID`]: id, [`RCLONE_CONFIG_${name}_SECRET_ACCESS_KEY`]: secret, [`RCLONE_CONFIG_${name}_NO_CHECK_BUCKET`]: "true" });
    const rcloneEnv = { ...process.env, ...remote("SRC", env.SOURCE_R2_ACCESS_KEY_ID, env.SOURCE_R2_SECRET_ACCESS_KEY), ...remote("DST", env.R2_ACCESS_KEY_ID, env.R2_SECRET_ACCESS_KEY) };
    run("rclone", ["sync", `SRC:${p.bucket.from}`, `DST:${p.bucket.to}`, "--checksum", "--metadata", "--transfers", "16", "--stats-one-line", "--stats", "30s"], { env: rcloneEnv });
    run("rclone", ["check", `SRC:${p.bucket.from}`, `DST:${p.bucket.to}`, "--checksum", "--one-way"], { env: rcloneEnv });

    // D1: export the source, recreate the target, import.
    const dump = join(work, "dump.sql");
    wrangler("d1", "export", p.db.from, "--remote", "--output", dump, "--skip-confirmation");
    writeFileSync(dump, prepareDump(readFileSync(dump, "utf8")));
    // Missing on a first clone into an instance that was never deployed.
    if (databases().includes(p.db.to)) wrangler("d1", "delete", p.db.to, "--skip-confirmation");
    wrangler("d1", "create", p.db.to, ...(p.db.location ? ["--location", p.db.location] : []));
    wrangler("d1", "execute", p.db.to, "--remote", "--file", dump, "--yes");
    // Production's sessions never become valid here: everyone signs in again.
    wrangler("d1", "execute", p.db.to, "--remote", "--command", "DELETE FROM sessions", "--yes");
    console.log(`clone-instance: done. Deploy the target now: its Workers are still bound to the deleted ${p.db.to}.`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
