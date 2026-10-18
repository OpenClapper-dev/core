#!/usr/bin/env node
// Sets a user's password from the command line, creating the user (with a personal workspace) when
// the email is new. The password is hashed here, in the same format as apps/worker/src/authn/password.ts,
// so it never reaches the database or a shell history in clear.
//
//   node scripts/user.mjs --email you@example.com [--name "You"] [--bootstrap] [--remote] [--iterations 100000]
//
// --bootstrap  give the bootstrap user (the owner of the pre-sign-in data, migration 0021) this email
//              and password instead of creating a user: the first sign-in of an existing instance.
// --remote     the deployed database (default: the local one of `wrangler dev`); needs deploy.env or the same
//              environment as scripts/deploy-config.mjs, whose config it uses.
// The password is read from FIELDER_PASSWORD, or asked for.
import { spawnSync } from "node:child_process";
import { webcrypto as crypto } from "node:crypto";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const BOOTSTRAP_USER_ID = "00000000-0000-4000-8000-000000000001";
const { values: opts } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    bootstrap: { type: "boolean", default: false },
    remote: { type: "boolean", default: false },
    iterations: { type: "string", default: "100000" },
  },
});
if (!opts.email || !opts.email.includes("@")) {
  console.error("usage: node scripts/user.mjs --email you@example.com [--name \"You\"] [--bootstrap] [--remote] [--iterations 100000]");
  process.exit(2);
}
const iterations = Number(opts.iterations);
if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > 100_000) {
  console.error("--iterations must be between 10000 and 100000 (the Workers maximum)");
  process.exit(2);
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.startsWith(question)) process.stdout.write(s); };
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); }));
}

const password = process.env.FIELDER_PASSWORD ?? (await ask("Password (at least 10 characters): "));
if (password.length < 10 || password.length > 200) {
  console.error("the password must be 10 to 200 characters");
  process.exit(2);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
const b64 = (b) => Buffer.from(b).toString("base64");
const hash = `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(bits)}`;

const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);
const now = q(new Date().toISOString());
const email = q(opts.email.trim());
let sql;
if (opts.bootstrap) {
  sql = `UPDATE users SET email = ${email}, name = coalesce(${q(opts.name)}, name), password_hash = ${q(hash)},
    status = 'active', failed_logins = 0, locked_until = NULL, updated_at = ${now} WHERE id = '${BOOTSTRAP_USER_ID}';`;
} else {
  const uid = q(crypto.randomUUID());
  const wid = q(crypto.randomUUID());
  // Known email: new password, unlocked. New email: the user, its personal workspace and membership
  // (the last two only if the user row was created by this run).
  sql = `UPDATE users SET password_hash = ${q(hash)}, failed_logins = 0, locked_until = NULL, updated_at = ${now}
      WHERE email = ${email} COLLATE NOCASE;
    INSERT INTO users (id, email, name, password_hash) SELECT ${uid}, ${email}, ${q(opts.name)}, ${q(hash)}
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ${email} COLLATE NOCASE);
    INSERT INTO workspaces (id, name, owner_user_id, kind) SELECT ${wid}, 'Personal', ${uid}, 'personal' WHERE EXISTS (SELECT 1 FROM users WHERE id = ${uid});
    INSERT INTO workspace_members (workspace_id, user_id, role) SELECT ${wid}, ${uid}, 'owner' WHERE EXISTS (SELECT 1 FROM users WHERE id = ${uid});`;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(root, "apps", "worker");
if (opts.remote) {
  const cfg = spawnSync("node", [join(root, "scripts", "deploy-config.mjs")], { stdio: "inherit" });
  if (cfg.status !== 0) process.exit(cfg.status ?? 1);
}
const where = opts.remote ? ["--remote", "--config", "wrangler.deploy.jsonc"] : ["--local"];
const res = spawnSync("npx", ["wrangler", "d1", "execute", "DB", ...where, "--command", sql], { cwd: worker, stdio: "inherit" });
if (res.status !== 0) process.exit(res.status ?? 1);
console.log(`${opts.bootstrap ? "Bootstrap user" : "User"} ${opts.email}: password set (${opts.remote ? "remote" : "local"} database).`);
