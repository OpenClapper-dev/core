/** The phone link (step B8, #380): channels, the layout preview, an extension's channel carried unread, the size limit. */
import { beforeAll, describe, expect, test } from "vitest";
import { BUILTIN_LAYOUTS } from "@openclapper/model";
import { api, newUser, uuid, type User } from "./helpers.ts";

let u: User;
beforeAll(async () => { u = await newUser(); });

describe("phone link", () => {
  /** A websocket into the caller's room, collecting what it receives. */
  async function socket(role: "phone" | "studio") {
    const res = await api(u.token, "GET", `/api/link?role=${role}`, undefined, { Upgrade: "websocket" });
    expect(res.status).toBe(101);
    const ws = res.webSocket!;
    const got: Record<string, unknown>[] = [];
    ws.addEventListener("message", (e) => { got.push(JSON.parse(String(e.data)) as Record<string, unknown>); });
    ws.accept();
    return { ws, got };
  }
  const until = async (fn: () => boolean) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20)); expect(fn()).toBe(true); };
  const layout = BUILTIN_LAYOUTS.viewfinder.body;

  test("the Studio sees the phone; a layout preview reaches it, an invalid or too large one does not; exit and stop", async () => {
    const phone = await socket("phone");
    const studio = await socket("studio");
    const device = uuid();
    phone.ws.send(JSON.stringify({ ch: "link", type: "hello", device: { id: device, name: "Pixel" } }));
    await until(() => studio.got.some((m) => m.type === "presence" && JSON.stringify(m.phones).includes("Pixel")));
    studio.ws.send(JSON.stringify({ ch: "layout", type: "preview", layout, orientation: "portrait", pad: "x".repeat(70 * 1024) }));
    studio.ws.send(JSON.stringify({ ch: "layout", type: "preview", layout: { ...layout, portrait: { bars: [] } }, orientation: "portrait" }));
    studio.ws.send(JSON.stringify({ ch: "layout", type: "preview", layout, orientation: "landscape" }));
    const previews = () => phone.got.filter((m) => m.ch === "layout" && m.type === "preview");
    await until(() => previews().length > 0);
    expect(previews().map((m) => m.orientation)).toEqual(["landscape"]);
    phone.ws.send(JSON.stringify({ ch: "layout", type: "exit" }));
    await until(() => studio.got.some((m) => m.ch === "layout" && m.type === "exit"));
    studio.ws.send(JSON.stringify({ ch: "link", type: "readout" }));
    await until(() => phone.got.some((m) => m.ch === "link" && m.type === "readout"));
    phone.ws.close();
    studio.ws.close();
  });

  test("an extension's channel goes both ways unread; a message without a channel is dropped", async () => {
    const phone = await socket("phone");
    const studio = await socket("studio");
    studio.ws.send(JSON.stringify({ ch: "hardware", type: "command", anything: [1, 2] }));
    studio.ws.send(JSON.stringify({ type: "no channel" }));
    phone.ws.send(JSON.stringify({ ch: "hardware", type: "state", ok: true }));
    await until(() => phone.got.some((m) => m.ch === "hardware" && m.type === "command"));
    await until(() => studio.got.some((m) => m.ch === "hardware" && m.type === "state"));
    expect(phone.got.some((m) => m.type === "no channel")).toBe(false);
    phone.ws.close();
    studio.ws.close();
  });
});
