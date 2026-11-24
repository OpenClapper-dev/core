/** Devices register themselves (step B3, #375): one record per account and fingerprint, kept current, the person's choices kept. */
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, test } from "vitest";
import { api, newUser, ok, uuid, type User } from "./helpers.ts";

interface DeviceFile { id: string; name: string; home: boolean; type: string; deleted_at: string | null; body: { kind: string; model: string; lenses: unknown[]; tabs: string[]; app: string } }
let a: User, b: User;
beforeAll(async () => { [a, b] = await Promise.all([newUser(), newUser()]); });
const report = (extra: Record<string, unknown> = {}) => ({ fingerprint: `fp-${uuid().slice(0, 12)}`, kind: "phone", make: "Google", model: "Pixel 9", lenses: [{ id: "0", name: "1×", focal35: 25, zoom: 1 }, { id: "1", name: "5×", focal35: 113, zoom: 5 }], screen: { portrait: { w: 412, h: 915 }, landscape: { w: 915, h: 412 } }, app: "0.16.0", ...extra });

describe("registering", () => {
  test("first time: a device file in the account home, named after the model, with the default tabs", async () => {
    const r = report();
    const made = await ok<{ file: DeviceFile }>(api(a.token, "POST", "/api/devices/register", r), 201);
    expect(made.file).toMatchObject({ type: "device", name: "Pixel 9", home: true, body: { kind: "phone", tabs: ["camera", "media", "shots", "setup"], app: "0.16.0" } });
    expect(made.file.body.lenses).toHaveLength(2);
  });

  test("again: the same record, what is reported replaced, the name and the tabs kept; out of the bin when binned", async () => {
    const r = report();
    const first = (await ok<{ file: DeviceFile }>(api(a.token, "POST", "/api/devices/register", r), 201)).file;
    await ok(api(a.token, "PUT", `/api/files/${first.id}`, { name: "My phone", body: { ...first.body, tabs: ["camera", "setup"] } }));
    await ok(api(a.token, "POST", "/api/files/bin", { ids: [first.id] }));
    const again = await ok<{ file: DeviceFile; restored: boolean }>(api(a.token, "POST", "/api/devices/register", { ...r, app: "0.17.0", lenses: [] }), 200);
    expect(again.restored).toBe(true);
    expect(again.file).toMatchObject({ id: first.id, name: "My phone", deleted_at: null, body: { app: "0.17.0", lenses: [], tabs: ["camera", "setup"] } });
  });

  test("the same fingerprint under another account is another record; neither sees the other", async () => {
    const r = report();
    const mine = (await ok<{ file: DeviceFile }>(api(a.token, "POST", "/api/devices/register", r), 201)).file;
    const theirs = (await ok<{ file: DeviceFile }>(api(b.token, "POST", "/api/devices/register", r), 201)).file;
    expect(theirs.id).not.toBe(mine.id);
    await ok(api(b.token, "GET", `/api/files/${mine.id}`), 404);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM devices WHERE fingerprint = ?1").bind(r.fingerprint).first()).toEqual({ n: 2 });
  });

  test("what is refused: a bad fingerprint, a wrong report; a device is never made through the file route", async () => {
    await ok(api(a.token, "POST", "/api/devices/register", report({ fingerprint: "x" })), 400);
    await ok(api(a.token, "POST", "/api/devices/register", report({ kind: "toaster" })), 400);
    await ok(api(a.token, "POST", "/api/devices/register", report({ lenses: [{ id: "0", name: "1×", focal35: "wide", zoom: 1 }] })), 400);
    await ok(api(a.token, "PUT", `/api/files/${uuid()}`, { type: "device", home: true, body: {} }), 400);
  });
});
