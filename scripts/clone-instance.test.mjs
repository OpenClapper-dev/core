// The clone's safety checks and dump handling (scripts/clone-instance.mjs); the Cloudflare calls are not run here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { plan, prepareDump, splitStatements, tableShape } from "./clone-instance.mjs";

const ok = {
  CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a",
  D1_DATABASE_NAME: "oc-staging-db", R2_BUCKET: "oc-staging-media",
  SOURCE_D1_DATABASE_NAME: "oc-db", SOURCE_R2_BUCKET: "oc-media",
  R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", SOURCE_R2_ACCESS_KEY_ID: "k2", SOURCE_R2_SECRET_ACCESS_KEY: "s2",
  CONFIRM: "oc-staging-db",
};

test("a complete, confirmed plan names source and target", () => {
  assert.deepEqual(plan({ ...ok, D1_LOCATION: "weur" }), { account: "a", db: { from: "oc-db", to: "oc-staging-db", location: "weur" }, bucket: { from: "oc-media", to: "oc-staging-media" } });
});

test("never the same database or bucket on both sides", () => {
  assert.throws(() => plan({ ...ok, D1_DATABASE_NAME: "oc-db", CONFIRM: "oc-db" }), /same D1 database/);
  assert.throws(() => plan({ ...ok, R2_BUCKET: "oc-media" }), /same R2 bucket/);
});

test("the confirmation must name the target, and every setting must be there", () => {
  assert.throws(() => plan({ ...ok, CONFIRM: "oc-db" }), /CONFIRM must be the target database's name, oc-staging-db/);
  assert.throws(() => plan({ ...ok, CONFIRM: undefined }), /CONFIRM/);
  const { SOURCE_R2_SECRET_ACCESS_KEY: _, ...missing } = ok;
  assert.throws(() => plan(missing), /SOURCE_R2_SECRET_ACCESS_KEY is not set/);
});

test("statements split only at top-level semicolons", () => {
  const sql = `INSERT INTO "a" VALUES('x; y','it''s; fine');
CREATE TABLE "b;c" (id TEXT); -- a comment; with a semicolon
CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET id = 'z;'; DELETE FROM b; END;
/* block; comment */ INSERT INTO b VALUES('q');`;
  assert.deepEqual(splitStatements(sql), [
    "INSERT INTO \"a\" VALUES('x; y','it''s; fine');",
    'CREATE TABLE "b;c" (id TEXT);',
    "CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET id = 'z;'; DELETE FROM b; END;",
    "INSERT INTO b VALUES('q');",
  ]);
});

test("a table's shape: primary key, references and which may be empty", () => {
  const sh = tableShape(`CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,
  note TEXT DEFAULT 'a, b (c)'
, root_framing_id TEXT REFERENCES framings(id) ON DELETE SET NULL)`);
  assert.deepEqual(sh.pk, ["id"]);
  assert.deepEqual(sh.refs, [{ column: "shot_id", table: "shots", required: true }, { column: "root_framing_id", table: "framings", required: false }]);
  const pair = tableShape('CREATE TABLE "m" (a TEXT NOT NULL, b TEXT, PRIMARY KEY (a, b), FOREIGN KEY (b) REFERENCES "n"(id))');
  assert.deepEqual([pair.name, pair.pk, pair.refs], ["m", ["a", "b"], [{ column: "b", table: "n", required: false }]]);
});

test("the dump becomes pragmas, tables, rows with parents first, then indexes", () => {
  // As D1 exports it: a table that gained a reference later comes before the table it references.
  const dump = `PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE shots (id TEXT PRIMARY KEY
, workspace_id TEXT REFERENCES workspaces(id));
INSERT INTO "shots" ("id","workspace_id") VALUES('s1','w1');
CREATE TABLE workspaces (id TEXT PRIMARY KEY);
INSERT INTO "workspaces" ("id") VALUES('w1');
DELETE FROM sqlite_sequence;
CREATE INDEX shots_ws_idx ON shots (workspace_id);
`;
  assert.equal(prepareDump(dump), `PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE shots (id TEXT PRIMARY KEY
, workspace_id TEXT REFERENCES workspaces(id));
CREATE TABLE workspaces (id TEXT PRIMARY KEY);
INSERT INTO "workspaces" ("id") VALUES('w1');
INSERT INTO "shots" ("id","workspace_id") VALUES('s1','w1');
DELETE FROM sqlite_sequence;
CREATE INDEX shots_ws_idx ON shots (workspace_id);
`);
  assert.match(prepareDump('CREATE TABLE "a" (id TEXT);\n'), /^PRAGMA defer_foreign_keys = TRUE;\nCREATE TABLE/);
});

test("a cycle and a self-reference: the optional side is inserted empty and set afterwards", () => {
  const dump = `CREATE TABLE photos (id TEXT PRIMARY KEY, root_framing_id TEXT REFERENCES framings(id));
CREATE TABLE framings (id TEXT PRIMARY KEY, photo_id TEXT NOT NULL REFERENCES photos(id));
CREATE TABLE folders (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES folders(id), name TEXT);
INSERT INTO "framings" ("id","photo_id") VALUES('f1','p1');
INSERT INTO "photos" ("id","root_framing_id") VALUES('p1','f1');
INSERT INTO "folders" ("id","parent_id","name") VALUES('child','parent','it''s, here');
INSERT INTO "folders" ("id","parent_id","name") VALUES('parent',NULL,'top');
`;
  const lines = prepareDump(dump).split("\n");
  const at = (start) => lines.findIndex((l) => l.startsWith(start));
  assert.ok(at('INSERT INTO "photos"') < at('INSERT INTO "framings"'));
  assert.ok(lines.includes(`INSERT INTO "photos" ("id","root_framing_id") VALUES('p1',NULL);`));
  assert.ok(lines.includes(`INSERT INTO "folders" ("id","parent_id","name") VALUES('child',NULL,'it''s, here');`));
  assert.ok(lines.includes(`INSERT INTO "folders" ("id","parent_id","name") VALUES('parent',NULL,'top');`));
  const updates = lines.filter((l) => l.startsWith("UPDATE"));
  assert.deepEqual(updates.sort(), [`UPDATE "folders" SET "parent_id" = 'parent' WHERE "id" = 'child';`, `UPDATE "photos" SET "root_framing_id" = 'f1' WHERE "id" = 'p1';`]);
  const lastInsert = Math.max(...lines.map((l, n) => (l.startsWith("INSERT") ? n : -1)));
  assert.ok(Math.min(...updates.map((u) => lines.indexOf(u))) > lastInsert);
});

test("required references in a cycle cannot be imported", () => {
  assert.throws(() => prepareDump("CREATE TABLE a (id TEXT PRIMARY KEY, b_id TEXT NOT NULL REFERENCES b(id));\nCREATE TABLE b (id TEXT PRIMARY KEY, a_id TEXT NOT NULL REFERENCES a(id));\n"), /required references form a cycle/);
});

test("a dump with a D1-internal table is refused, a migration named _cf_ is not", () => {
  assert.throws(() => prepareDump('CREATE TABLE IF NOT EXISTS "_cf_KV" (key TEXT);\n'), /_cf_/);
  assert.doesNotThrow(() => prepareDump(`INSERT INTO "d1_migrations" VALUES(24,'0024_cf_usage_daily.sql','x');\n`));
});
