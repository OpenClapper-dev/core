// The local dev ports (scripts/ports.mjs): unique, and a taken one is found and named.
import assert from "node:assert/strict";
import net from "node:net";
import { test } from "node:test";
import { check, PORTS, portsOf } from "./ports.mjs";

test("every server has its own ports, debuggers included", () => {
  const all = portsOf(Object.keys(PORTS)).map((p) => p.port);
  assert.equal(new Set(all).size, all.length);
  assert.throws(() => portsOf(["nope"]));
});

test("a taken port is reported with its server; free ones are not", async () => {
  const s = net.createServer();
  await new Promise((r) => s.listen(PORTS.specimen.http, "127.0.0.1", r));
  try {
    const busy = await check(["specimen"]);
    assert.deepEqual(busy.map((b) => [b.server, b.port]), [["specimen", PORTS.specimen.http]]);
  } finally { await new Promise((r) => s.close(r)); }
  assert.deepEqual(await check(["specimen"]), []);
});

test("the configs and start commands use the table's ports", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  assert.match(read("apps/studio/vite.config.ts"), new RegExp(`port: ${PORTS.studio.http},\\s*strictPort: true`));
  assert.match(read("apps/admin/vite.config.ts"), new RegExp(`port: ${PORTS.admin.http}, strictPort: true, proxy: \\{ "/api": "http://localhost:${PORTS["admin-worker"].http}"`));
  assert.match(read("apps/specimen/vite.config.ts"), new RegExp(`port: ${PORTS.specimen.http}, strictPort: true`));
  assert.match(read("apps/worker/package.json"), new RegExp(`wrangler dev --port ${PORTS.worker.http} --inspector-port ${PORTS.worker.inspector}`));
  assert.match(read("apps/admin/package.json"), new RegExp(`wrangler dev --port ${PORTS["admin-worker"].http} --inspector-port ${PORTS["admin-worker"].inspector}`));
  assert.match(read("scripts/mobile.sh"), new RegExp(`--inspector-port ${PORTS.worker.inspector} --tunnel`));
  assert.match(read("scripts/mobile.sh"), new RegExp(`--port ${PORTS.metro.http}$`, "m"));
});
