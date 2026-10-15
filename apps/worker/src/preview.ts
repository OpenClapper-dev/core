import { DurableObject } from "cloudflare:workers";
import { validateViewfinderLayout } from "@fielder/vocab";
import { HttpError, type Router } from "./http.ts";
import type { Ctx, Env } from "./index.ts";

/**
 * Live layout preview (issue #50). The phone keeps a websocket open while the app is in the
 * foreground; the dashboard's layout editor opens one too. Both land in one Durable Object per
 * user, which relays the edited layout to the phone. Nothing is stored in D1: a preview is a
 * look at an unsaved draft, gone when the dashboard closes it.
 *
 * Dashboard → phone: `{ type: "preview", layout, orientation }`, `{ type: "stop" }`.
 * Phone → dashboard: `{ type: "exit" }` (left the preview on the phone).
 * Room → dashboards: `{ type: "presence", phones, previewing }` on every change.
 */
type Role = "phone" | "dashboard";
interface Preview { type: "preview"; layout: unknown; orientation: "portrait" | "landscape" }

export function registerPreviewRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/preview/socket", async ({ request, env, url, identity }) => {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") throw new HttpError(426, "websocket upgrade expected");
    const role = url.searchParams.get("role");
    if (role !== "phone" && role !== "dashboard") throw new HttpError(400, "role must be phone or dashboard");
    // One room per signed-in person: their phone and their dashboard find each other without pairing.
    const who = identity.kind === "user" ? identity.email : `service:${identity.serviceTokenId}`;
    return env.PREVIEW.get(env.PREVIEW.idFromName(who)).fetch(request);
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
    let msg: { type?: unknown; layout?: unknown; orientation?: unknown };
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as typeof msg; } catch { return; }
    if (this.ctx.getTags(ws)[0] === "dashboard") {
      if (msg.type === "preview") {
        if (validateViewfinderLayout(msg.layout) || (msg.orientation !== "portrait" && msg.orientation !== "landscape")) return;
        const p: Preview = { type: "preview", layout: msg.layout, orientation: msg.orientation };
        await this.ctx.storage.put("preview", p);
        this.send("phone", p);
      } else if (msg.type === "stop") await this.stop();
      await this.presence();
    } else if (msg.type === "exit") {
      await this.ctx.storage.delete("preview");
      await this.presence();
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
    this.send("dashboard", { type: "presence", phones: this.open("phone", closing).length, previewing }, closing);
  }
}
