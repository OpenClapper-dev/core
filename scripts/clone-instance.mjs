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

/** Splits at top-level commas: not inside '…', "…", `…`, […] or parentheses. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0, cur = "", i = 0;
  while (i < text.length) {
    const c = text[i];
    const close = c === "'" ? "'" : c === '"' ? '"' : c === "`" ? "`" : c === "[" ? "]" : null;
    if (close) {
      let j = i + 1;
      while (j < text.length && !(text[j] === close && !(close === "'" && text[j + 1] === "'"))) j += close === "'" && text[j] === "'" ? 2 : 1;
      cur += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += c;
    i++;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
const ident = (s) => s.trim().replace(/^["`[]|["`\]]$/g, "");

/**
 * A table's shape from its CREATE TABLE: the columns, the primary key, and each reference with whether
 * its column may be empty. Column constraints (`x TEXT NOT NULL REFERENCES t(id)`) and table ones
 * (`FOREIGN KEY (x) REFERENCES t(id)`, `PRIMARY KEY (a, b)`) both count.
 */
export function tableShape(create) {
  const m = create.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|\S+?)\s*\(([\s\S]*)\)\s*;?\s*$/i);
  if (!m) return null;
  const shape = { name: ident(m[1]), pk: [], refs: [], notNull: new Set() };
  for (const def of splitTopLevel(m[2])) {
    const fk = def.match(/^FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+("[^"]+"|[\w]+)/i);
    if (fk) { for (const col of fk[1].split(",")) shape.refs.push({ column: ident(col), table: ident(fk[2]) }); continue; }
    const pk = def.match(/^(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i);
    if (pk) { shape.pk = pk[1].split(",").map((c) => ident(c.replace(/\s+(ASC|DESC)$/i, ""))); continue; }
    if (/^(CONSTRAINT|UNIQUE|CHECK)\b/i.test(def)) continue;
    const col = ident(def.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)/)[1]);
    if (/\bPRIMARY\s+KEY\b/i.test(def)) shape.pk = [col];
    if (/\bNOT\s+NULL\b/i.test(def) || /\bPRIMARY\s+KEY\b/i.test(def)) shape.notNull.add(col);
    const ref = def.match(/\bREFERENCES\s+("[^"]+"|[\w]+)/i);
    if (ref) shape.refs.push({ column: col, table: ident(ref[1]) });
  }
  for (const r of shape.refs) r.required = shape.notNull.has(r.column);
  return shape;
}

/**
 * Makes a D1 export importable into an empty database, whatever transactions the import runs in.
 * The export lists tables and rows in the database's own order, and a remote import does not keep one
 * transaction for the whole file (deferred foreign keys passed locally and failed remotely), so every
 * row must arrive after the rows it references:
 * - pragmas, then every table, then the rows, then indexes, triggers and views;
 * - the tables' rows ordered by their required references (NOT NULL), parents first;
 * - an optional reference that would point forward (a cycle such as photos.root_framing_id ↔
 *   framings.photo_id, or a self-reference such as folders.parent_id) is inserted empty and set by an
 *   UPDATE once every row is in.
 * Foreign keys stay deferred as a second safety. Refuses a dump that would recreate a D1-internal table
 * (`_cf_…`), and a cycle of required references, which no order can satisfy.
 */
export function prepareDump(sql) {
  const statements = splitStatements(sql);
  if (statements.some((st) => /^CREATE TABLE (IF NOT EXISTS )?"?_cf_/i.test(st))) throw new Error("the export contains a D1-internal _cf_ table; importing it would fail");
  const pragmas = [], creates = [], rest = [], later = [];
  const rows = new Map(); // table → its INSERTs, in export order
  for (const st of statements) {
    if (/^PRAGMA\b/i.test(st)) pragmas.push(st);
    else if (/^CREATE\s+(VIRTUAL\s+)?TABLE\b/i.test(st)) creates.push(st);
    else if (/^CREATE\b/i.test(st)) later.push(st);
    else {
      const ins = st.match(/^INSERT\s+INTO\s+("[^"]+"|\S+)/i);
      const t = ins && ident(ins[1]);
      if (t && t !== "sqlite_sequence") { if (!rows.has(t)) rows.set(t, []); rows.get(t).push(st); } else rest.push(st);
    }
  }
  const shapes = new Map(creates.map(tableShape).filter(Boolean).map((sh) => [sh.name, sh]));

  // Parents first: a table goes once every table it references is placed. In a cycle, the first table
  // whose required references are placed goes, and its optional references to unplaced tables are set
  // afterwards; so are optional self-references (folders.parent_id). A required cycle cannot be imported.
  const order = [], placed = new Set(), lateCols = new Map();
  const remaining = [...shapes.keys()];
  const deps = (t, required) => (shapes.get(t).refs).filter((r) => (!required || r.required) && r.table !== t && shapes.has(r.table));
  for (const sh of shapes.values()) {
    if (sh.refs.some((r) => r.table === sh.name && r.required)) throw new Error(`${sh.name} references itself with a required column`);
  }
  while (remaining.length) {
    let i = remaining.findIndex((t) => deps(t, false).every((r) => placed.has(r.table)));
    if (i < 0) i = remaining.findIndex((t) => deps(t, true).every((r) => placed.has(r.table)));
    if (i < 0) throw new Error(`required references form a cycle among ${remaining.join(", ")}`);
    const t = remaining.splice(i, 1)[0];
    lateCols.set(t, shapes.get(t).refs.filter((r) => !r.required && (r.table === t || (shapes.has(r.table) && !placed.has(r.table)))).map((r) => r.column));
    placed.add(t);
    order.push(t);
  }

  const inserts = [], updates = [];
  for (const t of [...order, ...[...rows.keys()].filter((t) => !placed.has(t))]) {
    const sh = shapes.get(t);
    const late = lateCols.get(t) ?? [];
    for (const st of rows.get(t) ?? []) {
      if (!late.length) { inserts.push(st); continue; }
      const m = st.match(/^(INSERT\s+INTO\s+\S+\s*)\(([^)]*)\)\s*VALUES\s*\(([\s\S]*)\)\s*;?$/i);
      if (!m) throw new Error(`cannot read an INSERT into ${t} to postpone its references`);
      const cols = splitTopLevel(m[2]).map(ident), vals = splitTopLevel(m[3]);
      if (!sh.pk.length || sh.pk.some((k) => !cols.includes(k))) throw new Error(`${t} has no primary key in its INSERTs to set references afterwards`);
      const set = [];
      for (const c of late) {
        const i = cols.indexOf(c);
        if (i >= 0 && !/^NULL$/i.test(vals[i])) { set.push(`"${c}" = ${vals[i]}`); vals[i] = "NULL"; }
      }
      inserts.push(`${m[1]}(${m[2]}) VALUES(${vals.join(",")});`);
      if (set.length) updates.push(`UPDATE "${t}" SET ${set.join(", ")} WHERE ${sh.pk.map((k) => `"${k}" = ${vals[cols.indexOf(k)]}`).join(" AND ")};`);
    }
  }
  if (!pragmas.some((st) => /^PRAGMA\s+defer_foreign_keys\s*=\s*(TRUE|ON|1)\s*;?$/i.test(st))) pragmas.unshift("PRAGMA defer_foreign_keys = TRUE;");
  const out = [...pragmas, ...creates, ...inserts, ...updates, ...rest, ...later];
  return `${out.map((st) => (st.endsWith(";") ? st : `${st};`)).join("\n")}\n`;
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
