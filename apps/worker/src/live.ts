import { DurableObject } from "cloudflare:workers";
import { assertUuid, HttpError, type Router } from "@openclapper/service-kit";
import { fileType } from "@openclapper/model";
import { accessFile } from "./files.ts";
import type { Ctx, Env } from "./index.ts";

/**
 * A file watched live (docs/features/canvas.md, "Live updates"): one Durable Object per lockable file (a canvas,
 * a shot, a timeline; the class keeps its first name, CanvasRoom) that is
 * open in a project set to realtime. The window that holds the edit lock connects as the editor and sends
 * what it changes; every other window connects as a viewer and gets it. Nothing is stored here: saves
 * still go to D1 through the lock, a viewer that connects reads the canvas from the API, and the room
 * sleeps (hibernation) between messages.
 *
 * Editor → room: `{ type: "doc", body, base?, refs? }` (the file after a change, throttled by the editor),
 * `{ type: "draft", draft }` (a stroke being drawn; null when it ends), `{ type: "held" }` (after each renewal),
 * `{ type: "saved" }` (after a save, when the canvas was too large to send).
 * Room → viewers: the same `doc`, `draft` and `saved`, and `{ type: "editor", by }` when an editor connects, renews
 * or leaves (by: a user id, or null).
 */

/** Larger messages are dropped: the editor then sends none and viewers read the canvas from the API after each save. */
export const MAX_LIVE_BYTES = 1024 * 1024;

const readHolder = (v: string | null) => {
  if (!v || !/^[\w-]{8,64}$/.test(v)) throw new HttpError(400, "holder must be the editing window's token");
  return v;
};

export function registerLiveRoutes(r: Router<Ctx>) {
  /**
   * The live socket of a canvas (`?holder=`): the editor when this window holds the lock, else a viewer.
   * `409` when the project watches its canvases every 5 seconds instead.
   */
  r.on("GET", "/api/canvases/:id/live", async (ctx, { id }) => {
    const { env, request, url, tenant } = ctx;
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") throw new HttpError(426, "websocket upgrade expected");
    const f = await accessFile(ctx, assertUuid(id, "id"), "viewer");
    if (!fileType(f.type)?.lockable) throw new HttpError(400, "only a file edited under a lock is watched live");
    const holder = readHolder(url.searchParams.get("holder"));
    const row = await env.DB.prepare("SELECT f.lock_by, f.lock_holder, f.lock_until, p.canvas_live FROM files f JOIN projects p ON p.id = f.project_id WHERE f.id = ?1")
      .bind(f.id).first<{ lock_by: string | null; lock_holder: string | null; lock_until: string | null; canvas_live: string }>();
    if (row?.canvas_live !== "realtime") throw new HttpError(409, "this project's canvases are not watched in realtime");
    const editor = row.lock_by === tenant.userId && row.lock_holder === holder && !!row.lock_until && row.lock_until > new Date().toISOString();
    const to = new URL(request.url);
    to.search = new URLSearchParams({ role: editor ? "editor" : "viewer", user: tenant.userId, holder }).toString();
    return env.CANVAS_LIVE.get(env.CANVAS_LIVE.idFromName(f.id)).fetch(new Request(to, request));
  });
}

type Role = "editor" | "viewer";
interface Who { user: string; holder: string }

export class CanvasRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const q = new URL(request.url).searchParams;
    const role = q.get("role") === "editor" ? "editor" : "viewer";
    const who: Who = { user: q.get("user") ?? "", holder: q.get("holder") ?? "" };
    const { 0: client, 1: server } = new WebSocketPair();
    // One lock, one editor: a socket left from an editor that lost the lock is closed.
    if (role === "editor") for (const w of this.open("editor")) { try { w.close(4000, "another window edits now"); } catch { /* gone */ } }
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment(who);
    if (role === "editor") this.send("viewer", { type: "editor", by: who.user });
    else {
      const ed = this.open("editor")[0];
      server.send(JSON.stringify({ type: "editor", by: ed ? (ed.deserializeAttachment() as Who).user : null }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (this.ctx.getTags(ws)[0] !== "editor") return;
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    if (text.length > MAX_LIVE_BYTES) return;
    let msg: { type?: unknown; body?: unknown; base?: unknown; refs?: unknown; draft?: unknown };
    try { msg = JSON.parse(text) as typeof msg; } catch { return; }
    // The room checks the shape only: what a viewer shows is drawn by the editor's own code, and nothing is stored.
    if (msg.type === "doc" && msg.body && typeof msg.body === "object" && (msg.base === undefined || msg.base === null || typeof msg.base === "string") && (msg.refs === undefined || Array.isArray(msg.refs))) {
      this.send("viewer", { type: "doc", body: msg.body, ...(msg.base !== undefined ? { base: msg.base } : {}), ...(msg.refs !== undefined ? { refs: msg.refs } : {}) });
    }
    else if (msg.type === "draft" && (msg.draft === null || typeof msg.draft === "object")) this.send("viewer", { type: "draft", draft: msg.draft });
    else if (msg.type === "saved") this.send("viewer", { type: "saved" });
    else if (msg.type === "held") this.send("viewer", { type: "editor", by: (ws.deserializeAttachment() as Who).user });
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 ? 1000 : code); } catch { /* already closed */ }
    if (this.ctx.getTags(ws)[0] === "editor" && this.open("editor", ws).length === 0) this.send("viewer", { type: "editor", by: null });
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws, 1011);
  }

  private open(role: Role, closing?: WebSocket) {
    return this.ctx.getWebSockets(role).filter((w) => w !== closing && w.readyState === WebSocket.OPEN);
  }

  private send(role: Role, msg: unknown) {
    const data = JSON.stringify(msg);
    for (const w of this.open(role)) { try { w.send(data); } catch { /* gone */ } }
  }
}
