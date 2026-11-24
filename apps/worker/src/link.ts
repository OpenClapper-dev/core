import { DurableObject } from "cloudflare:workers";
import { layoutError } from "@openclapper/model";
import { HttpError, type Router } from "@openclapper/service-kit";
import type { Ctx, Env } from "./index.ts";

/**
 * The phone link (docs/rewrite/08-extensions.md, "One live link, with channels"): one connection between a
 * person's Studio tabs and their phones and tablets, through one Durable Object per person (the hibernation API:
 * an idle phone costs nothing). Every message names its channel (`ch`). The core reads two channels:
 *
 * - `link`: phone → room `{ type: "hello", device: { id, name } }` (kept on the socket); Studio → phones
 *   `{ type: "readout" }` (register again now: the device file is read again); room → Studio tabs
 *   `{ type: "presence", phones: [{ id, name }], previewing }` on every change; room → phones `{ type: "presence", studios }`
 *   (how many Studio tabs are open).
 * - `layout`: Studio → phones `{ type: "preview", layout, orientation, device? }` (a camera layout shown on the
 *   phone without saving it; validated; kept for a phone that connects later), `{ type: "stop" }`; phone → Studio
 *   `{ type: "exit" }` (the person left the preview on the phone). The last Studio tab gone ends a preview.
 *
 * Any other channel is an extension's: its messages go unread from the Studio to the phones, and from a phone to the
 * Studio tabs and the other phones (a tablet controls hardware through the phone that holds it), at most 64 KiB each. The class keeps its first name (PreviewRoom): renaming a Durable Object class is a migration.
 */
type Role = "phone" | "studio";
interface Hello { id: string; name: string }
interface Preview { ch: "layout"; type: "preview"; layout: unknown; orientation: "portrait" | "landscape"; device: string | null }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL = /^[a-z][a-z0-9-]{1,30}$/;
/** Larger messages are dropped unread: a layout is far smaller, and the room's storage takes at most 128 KiB per value. */
export const MAX_MESSAGE_BYTES = 64 * 1024;
const tooLarge = (raw: string | ArrayBuffer) =>
  typeof raw === "string" ? raw.length > MAX_MESSAGE_BYTES || new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES : raw.byteLength > MAX_MESSAGE_BYTES;

export function registerLinkRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/link", async ({ request, env, url, identity }) => {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") throw new HttpError(426, "websocket upgrade expected");
    const role = url.searchParams.get("role");
    if (role !== "phone" && role !== "studio") throw new HttpError(400, "role must be phone or studio");
    // One room per signed-in person: their phones and their Studio tabs find each other without pairing.
    return env.PREVIEW.get(env.PREVIEW.idFromName(identity.userId)).fetch(request);
  });
}

export class PreviewRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get("role") as Role;
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [role]);
    const current = await this.ctx.storage.get<Preview>("preview");
    if (role === "phone" && current) server.send(JSON.stringify(current));
    await this.presence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (tooLarge(raw)) return;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as Record<string, unknown>; } catch { return; }
    if (typeof msg !== "object" || msg === null || typeof msg.ch !== "string") return;
    const from = this.ctx.getTags(ws)[0] as Role;
    if (msg.ch === "link") {
      if (from === "phone" && msg.type === "hello") {
        const d = msg.device as { id?: unknown; name?: unknown } | undefined;
        if (typeof d?.id !== "string" || !UUID.test(d.id)) return;
        ws.serializeAttachment({ id: d.id, name: typeof d.name === "string" ? d.name.slice(0, 120) : "" } satisfies Hello);
        await this.presence();
      } else if (from === "studio" && msg.type === "readout") this.send("phone", { ch: "link", type: "readout" });
      return;
    }
    if (msg.ch === "layout") {
      if (from === "studio" && msg.type === "preview") {
        if (!msg.layout || typeof msg.layout !== "object" || layoutError(msg.layout as Record<string, unknown>) || (msg.orientation !== "portrait" && msg.orientation !== "landscape")) return;
        const device = typeof msg.device === "string" && UUID.test(msg.device) ? msg.device : null;
        const p: Preview = { ch: "layout", type: "preview", layout: msg.layout, orientation: msg.orientation, device };
        await this.ctx.storage.put("preview", p);
        this.send("phone", p);
        await this.presence();
      } else if (from === "studio" && msg.type === "stop") { await this.stop(); await this.presence(); }
      else if (from === "phone" && msg.type === "exit") { await this.ctx.storage.delete("preview"); this.send("studio", { ch: "layout", type: "exit" }); await this.presence(); }
      return;
    }
    // An extension's channel: carried to the other side, unread.
    if (!CHANNEL.test(msg.ch)) return;
    if (from === "studio") this.send("phone", msg);
    else { this.send("studio", msg); this.send("phone", msg, undefined, ws); }
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 ? 1000 : code); } catch { /* already closed */ }
    // The last Studio tab gone ends the preview: the phone never stays stuck in it.
    if (this.ctx.getTags(ws)[0] === "studio" && this.open("studio", ws).length === 0) await this.stop();
    await this.presence(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1011);
  }

  private async stop() {
    if (!(await this.ctx.storage.get("preview"))) return;
    await this.ctx.storage.delete("preview");
    this.send("phone", { ch: "layout", type: "stop" });
  }

  /** Open sockets with a role; `closing` is still listed while its close handler runs. */
  private open(role: Role, closing?: WebSocket) {
    return this.ctx.getWebSockets(role).filter((w) => w !== closing && w.readyState === WebSocket.OPEN);
  }

  private send(role: Role, msg: unknown, closing?: WebSocket, except?: WebSocket) {
    const data = JSON.stringify(msg);
    for (const w of this.open(role, closing)) { if (w === except) continue; try { w.send(data); } catch { /* gone */ } }
  }

  private async presence(closing?: WebSocket) {
    const previewing = !!(await this.ctx.storage.get("preview"));
    // A phone that has not said hello yet (just connected) shows without an id.
    const phones = this.open("phone", closing).map((w) => (w.deserializeAttachment() as Hello | null) ?? { id: null, name: "" });
    this.send("studio", { ch: "link", type: "presence", phones, previewing }, closing);
    this.send("phone", { ch: "link", type: "presence", studios: this.open("studio", closing).length }, closing);
  }
}
