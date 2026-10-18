import { DurableObject } from "cloudflare:workers";
import { validateDeviceSpecs, validateViewfinderLayout } from "@fielder/vocab";
import { HttpError, type Router } from "./http.ts";
import type { Ctx, Env } from "./index.ts";

/**
 * Live layout preview (issue #50). The phone keeps a websocket open while the app is in the
 * foreground; the dashboard's layout editor opens one too. Both land in one Durable Object per
 * user, which relays the edited layout to the phone. Nothing is stored in D1: a preview is a
 * look at an unsaved draft, gone when the dashboard closes it.
 *
 * Dashboard → phone: `{ type: "preview", layout, orientation }`, `{ type: "stop" }`, `{ type: "readout" }`
 * (issue #68: send your specs now).
 * Phone → room: `{ type: "hello", device: { id, model } }` on connect (kept on the socket for presence).
 * Phone → dashboard: `{ type: "exit" }` (left the preview on the phone), `{ type: "specs", id, specs }`.
 * Room → dashboards: `{ type: "presence", phones: [{ id, model }], previewing }` on every change.
 */
type Role = "phone" | "dashboard";
interface Preview { type: "preview"; layout: unknown; orientation: "portrait" | "landscape" }
interface PhoneHello { id: string; model: string | null }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerPreviewRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/preview/socket", async ({ request, env, url, identity }) => {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") throw new HttpError(426, "websocket upgrade expected");
    const role = url.searchParams.get("role");
    if (role !== "phone" && role !== "dashboard") throw new HttpError(400, "role must be phone or dashboard");
    // One room per signed-in person: their phone and their dashboard find each other without pairing.
    return env.PREVIEW.get(env.PREVIEW.idFromName(identity.userId)).fetch(request);
  });
}

export class PreviewRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get("role") as Role;
    const { 0: client, 1: server } = new WebSocketPair();
    // Hibernation API: the object sleeps between messages, so an idle phone connection costs nothing.
    this.ctx.acceptWebSocket(server, [role]);
    const current = await this.ctx.storage.get<Preview>("preview");
    if (role === "phone" && current) server.send(JSON.stringify(current));
    await this.presence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: { type?: unknown; layout?: unknown; orientation?: unknown; device?: { id?: unknown; model?: unknown }; id?: unknown; specs?: unknown };
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as typeof msg; } catch { return; }
    if (this.ctx.getTags(ws)[0] === "dashboard") {
      if (msg.type === "preview") {
        if (validateViewfinderLayout(msg.layout) || (msg.orientation !== "portrait" && msg.orientation !== "landscape")) return;
        const p: Preview = { type: "preview", layout: msg.layout, orientation: msg.orientation };
        await this.ctx.storage.put("preview", p);
        this.send("phone", p);
      } else if (msg.type === "stop") await this.stop();
      else if (msg.type === "readout") { this.send("phone", { type: "readout" }); return; }
      await this.presence();
    } else if (msg.type === "exit") {
      await this.ctx.storage.delete("preview");
      await this.presence();
    } else if (msg.type === "hello") {
      const id = msg.device?.id, model = msg.device?.model;
      if (typeof id !== "string" || !UUID.test(id)) return;
      ws.serializeAttachment({ id, model: typeof model === "string" ? model.slice(0, 80) : null } satisfies PhoneHello);
      await this.presence();
    } else if (msg.type === "specs") {
      if (typeof msg.id !== "string" || !UUID.test(msg.id) || validateDeviceSpecs(msg.specs)) return;
      this.send("dashboard", { type: "specs", id: msg.id, specs: msg.specs });
    }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 ? 1000 : code); } catch { /* already closed */ }
    // The last dashboard gone ends the preview: the phone never stays stuck in it.
    if (this.ctx.getTags(ws)[0] === "dashboard" && this.open("dashboard", ws).length === 0) await this.stop();
    await this.presence(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1011);
  }

  private async stop() {
    if (!(await this.ctx.storage.get("preview"))) return;
    await this.ctx.storage.delete("preview");
    this.send("phone", { type: "stop" });
  }

  /** Open sockets with a role; `closing` is still listed while its close handler runs. */
  private open(role: Role, closing?: WebSocket) {
    return this.ctx.getWebSockets(role).filter((w) => w !== closing && w.readyState === WebSocket.OPEN);
  }

  private send(role: Role, msg: unknown, closing?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const w of this.open(role, closing)) { try { w.send(data); } catch { /* gone */ } }
  }

  private async presence(closing?: WebSocket) {
    const previewing = !!(await this.ctx.storage.get("preview"));
    // A phone that has not said hello yet (just connected) shows without an id.
    const phones = this.open("phone", closing).map((w) => (w.deserializeAttachment() as PhoneHello | null) ?? { id: null, model: null });
    this.send("dashboard", { type: "presence", phones, previewing }, closing);
  }
}
