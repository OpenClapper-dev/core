/** The preview room's message size limit (#224); it stays until the phone link of step B8 replaces it. */
import { beforeAll, describe, expect, test } from "vitest";
import { api, newUser, type User } from "./helpers.ts";
import { DEFAULT_VIEWFINDER_LAYOUT } from "@openclapper/vocab";

let u: User;
beforeAll(async () => { u = await newUser(); });

describe("preview room", () => {
  /** A websocket into the caller's room, collecting what it receives. */
  async function socket(role: "phone" | "studio") {
    const res = await api(u.token, "GET", `/api/preview/socket?role=${role}`, undefined, { Upgrade: "websocket" });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const got: Record<string, unknown>[] = [];
    ws.addEventListener("message", (e) => got.push(JSON.parse(String(e.data)) as Record<string, unknown>));
    ws.accept();
    return { ws, got };
  }
  const until = async (fn: () => boolean) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); expect(fn()).toBe(true); };

  test("a message over 64 KiB is dropped; the next normal one is relayed", async () => {
    const phone = await socket("phone");
    const studio = await socket("studio");
    // Valid apart from its size: the padding sits outside the layout, which passes validation.
    studio.ws.send(JSON.stringify({ type: "preview", layout: DEFAULT_VIEWFINDER_LAYOUT, orientation: "portrait", pad: "x".repeat(70 * 1024) }));
    studio.ws.send(JSON.stringify({ type: "preview", layout: DEFAULT_VIEWFINDER_LAYOUT, orientation: "landscape" }));
    const previews = () => phone.got.filter((m) => m.type === "preview");
    await until(() => previews().length > 0);
    expect(previews().map((m) => m.orientation)).toEqual(["landscape"]);
    studio.ws.send(JSON.stringify({ type: "stop" }));
    phone.ws.close();
    studio.ws.close();
  });

  test("light proxy (#307): commands relayed only when valid, state to the Studio, studios counted for the phone", async () => {
    const phone = await socket("phone");
    const studio = await socket("studio");
    // The Studio connecting asks the phone to report.
    await until(() => phone.got.some((m) => m.type === "lights.hello"));
    await until(() => phone.got.some((m) => m.type === "lights.studios" && m.count === 1));
    const fixtureId = "00000000-0000-4000-8000-000000000001";
    studio.ws.send(JSON.stringify({ type: "lights.command", fixtureId, command: { op: "intensity", value: 2 } }));
    studio.ws.send(JSON.stringify({ type: "lights.command", fixtureId: "not-a-uuid", command: { op: "power", on: true } }));
    studio.ws.send(JSON.stringify({ type: "lights.command", fixtureId, command: { op: "intensity", value: 0.3, sneaky: true } }));
    const commands = () => phone.got.filter((m) => m.type === "lights.command");
    await until(() => commands().length > 0);
    expect(commands()).toEqual([{ type: "lights.command", fixtureId, command: { op: "intensity", value: 0.3 } }]);
    // Pairing from the Studio: requests to the phone, progress back.
    studio.ws.send(JSON.stringify({ type: "lights.scan", on: "yes" }));
    studio.ws.send(JSON.stringify({ type: "lights.scan", on: true }));
    studio.ws.send(JSON.stringify({ type: "lights.provision", fixtureId: "nope" }));
    studio.ws.send(JSON.stringify({ type: "lights.provision", fixtureId, fresh: true }));
    studio.ws.send(JSON.stringify({ type: "lights.sync", extra: 1 }));
    await until(() => phone.got.some((m) => m.type === "lights.sync"));
    expect(phone.got.filter((m) => m.type === "lights.scan")).toEqual([{ type: "lights.scan", on: true }]);
    expect(phone.got.filter((m) => m.type === "lights.provision")).toEqual([{ type: "lights.provision", fixtureId, fresh: true }]);
    expect(phone.got.find((m) => m.type === "lights.sync")).toEqual({ type: "lights.sync" });
    phone.ws.send(JSON.stringify({ type: "lights.scan.state", phase: "scanning", found: [] }));
    phone.ws.send(JSON.stringify({ type: "lights.provision.state", fixtureId, phase: "running", stage: "find", resume: false }));
    await until(() => studio.got.some((m) => m.type === "lights.provision.state") && studio.got.some((m) => m.type === "lights.scan.state"));
    // Running a sequence on the phone (#321): validated on the way there, state relayed back.
    studio.ws.send(JSON.stringify({ type: "lights.run", sequenceId: "nope", revision: "r", fromMs: 0 }));
    studio.ws.send(JSON.stringify({ type: "lights.run", sequenceId: fixtureId, revision: "2026-11-09T10:00:00.000Z", fromMs: 1500.4, extra: 1 }));
    studio.ws.send(JSON.stringify({ type: "lights.run.stop" }));
    await until(() => phone.got.some((m) => m.type === "lights.run.stop"));
    expect(phone.got.filter((m) => m.type === "lights.run")).toEqual([{ type: "lights.run", sequenceId: fixtureId, revision: "2026-11-09T10:00:00.000Z", fromMs: 1500 }]);
    phone.ws.send(JSON.stringify({ type: "lights.run.state", phase: "playing", sequenceId: fixtureId, atMs: 100 }));
    await until(() => studio.got.some((m) => m.type === "lights.run.state" && m.phase === "playing"));
    phone.ws.send(JSON.stringify({ type: "lights.state", phone: { id: fixtureId, model: "x" }, proxy: true, fixtures: [] }));
    await until(() => studio.got.some((m) => m.type === "lights.state" && m.proxy === true));
    studio.ws.close();
    await until(() => phone.got.some((m) => m.type === "lights.studios" && m.count === 0));
    phone.ws.close();
  });
});
