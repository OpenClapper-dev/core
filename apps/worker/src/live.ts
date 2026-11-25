import { DurableObject } from "cloudflare:workers";
import { assertUuid, HttpError, type Router } from "@openclapper/service-kit";
import { fileType } from "@openclapper/model";
import { accessFile } from "./files.ts";
import { assertAccess } from "./tenancy.ts";
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
 *
 * The lock itself is live in every project (#426): the lock routes tell the room when it is taken, renewed or let
 * go, a save tells it `saved`, and an alarm at the lock's end says when it ran out, so who edits is never stale on
 * any client, the device's Flows editor included. Only the content (`doc`, `draft`) waits for a realtime project.
 */

/** Larger messages are dropped: the editor then sends none and viewers read the canvas from the API after each save. */
export const MAX_LIVE_BYTES = 1024 * 1024;

const readHolder = (v: string | null) => {
  if (!v || !/^[\w-]{8,64}$/.test(v)) throw new HttpError(400, "holder must be the editing window's token");
  return v;
};

export function registerLiveRoutes(r: Router<Ctx>) {
  /**
   * A root's live socket (#426): `?project_id=` or `?home=1`. It hears `changed` whenever a write changed a file of
   * the root, from any client, so open file lists read it again instead of waiting for a reload.
   */
  r.on("GET", "/api/live/root", async (ctx) => {
    const { env, request, url, tenant } = ctx;
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") throw new HttpError(426, "websocket upgrade expected");
    const project = url.searchParams.get("project_id");
    let key: string;
    if (url.searchParams.get("home") === "1") key = `home:${tenant.userId}`;
    else if (project) { const pid = assertUuid(project, "project_id"); await assertAccess(ctx, "project", pid, "viewer"); key = pid; }
    else throw new HttpError(400, "name a root: project_id, or home");
    const to = new URL(request.url);
    to.search = new URLSearchParams({ role: "viewer", user: tenant.userId, holder: "root-watcher" }).toString();
    return env.CANVAS_LIVE.get(env.CANVAS_LIVE.idFromName(`root:${key}`)).fetch(new Request(to, request));
  });

  /** The live socket of a lockable file (`?holder=`): the editor when this window holds the lock, else a viewer. */
  r.on("GET", "/api/canvases/:id/live", async (ctx, { id }) => {
    const { env, request, url, tenant } = ctx;
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") throw new HttpError(426, "websocket upgrade expected");
    const f = await accessFile(ctx, assertUuid(id, "id"), "viewer");
    if (!fileType(f.type)?.lockable) throw new HttpError(400, "only a file edited under a lock is watched live");
    const holder = readHolder(url.searchParams.get("holder"));
    const row = await env.DB.prepare("SELECT lock_by, lock_holder, lock_until FROM files WHERE id = ?1")
      .bind(f.id).first<{ lock_by: string | null; lock_holder: string | null; lock_until: string | null }>();
    if (!row) throw new HttpError(404, "file not found");
    const editor = row.lock_by === tenant.userId && row.lock_holder === holder && !!row.lock_until && row.lock_until > new Date().toISOString();
    const to = new URL(request.url);
    to.search = new URLSearchParams({ role: editor ? "editor" : "viewer", user: tenant.userId, holder }).toString();
    return env.CANVAS_LIVE.get(env.CANVAS_LIVE.idFromName(f.id)).fetch(new Request(to, request));
  });
}

/**
 * Tells a file's room what changed outside it: the lock (who holds it now, and until when) or a save. Never fails
 * the request that changed it: the room is a convenience, the database is the truth.
 */
export async function tellRoom(env: Env, fileId: string, msg: { type: "lock"; by: string | null; until: string | null } | { type: "saved" }) {
  try {
    await env.CANVAS_LIVE.get(env.CANVAS_LIVE.idFromName(fileId)).fetch(new Request("https://room/notify", { method: "POST", body: JSON.stringify({ file: fileId, ...msg }) }));
  } catch (e) { console.warn("live: room not told", fileId, e); }
}

/** A root's files changed (#426): its room ("root:<project id>" or "root:home:<user id>") tells every open client. */
export async function rootChanged(env: Env, root: string) {
  try {
    await env.CANVAS_LIVE.get(env.CANVAS_LIVE.idFromName(`root:${root}`)).fetch(new Request("https://room/notify", { method: "POST", body: JSON.stringify({ type: "changed" }) }));
  } catch (e) { console.warn("live: root not told", root, e); }
}

type Role = "editor" | "viewer";
interface Who { user: string; holder: string }

export class CanvasRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/notify") return this.notify(await request.json());
    const q = url.searchParams;
    const role = q.get("role") === "editor" ? "editor" : "viewer";
    const who: Who = { user: q.get("user") ?? "", holder: q.get("holder") ?? "" };
    const { 0: client, 1: server } = new WebSocketPair();
    // One lock, one editor: a socket left from an editor that lost the lock is closed.
    if (role === "editor") for (const w of this.open("editor")) { try { w.close(4000, "another window edits now"); } catch { /* gone */ } }
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment(who);
    if (role === "editor") this.send("viewer", { type: "editor", by: who.user });
    else {
      // Who edits: the editor's socket, else the lock as the routes last told it (one taken without a socket: the device).
      const ed = this.open("editor")[0];
      const lock = await this.ctx.storage.get<{ by: string; until: string }>("lock");
      const held = lock && new Date(lock.until).getTime() > Date.now() ? lock.by : null;
      server.send(JSON.stringify({ type: "editor", by: ed ? (ed.deserializeAttachment() as Who).user : held }));
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

  /** From the lock routes and saves: every socket hears who edits now; a lock's end is watched with an alarm. */
  private async notify(m: { file: string; type: string; by?: string | null; until?: string | null }): Promise<Response> {
    if (m.type === "saved" || m.type === "changed") { this.sendAll({ type: m.type }); return new Response(null, { status: 204 }); }
    await this.ctx.storage.put("file", m.file);
    this.sendAll({ type: "editor", by: m.by ?? null });
    if (m.by && m.until) { await this.ctx.storage.put("lock", { by: m.by, until: m.until }); await this.ctx.storage.setAlarm(new Date(m.until).getTime() + 1000); }
    else { await this.ctx.storage.delete("lock"); await this.ctx.storage.deleteAlarm(); }
    return new Response(null, { status: 204 });
  }

  /** The lock's end passed: unless it was renewed, it ran out, and everyone hears it is free. */
  async alarm() {
    const file = await this.ctx.storage.get<string>("file");
    if (!file) return;
    const row = await this.env.DB.prepare("SELECT lock_by, lock_until FROM files WHERE id = ?1").bind(file).first<{ lock_by: string | null; lock_until: string | null }>();
    const until = row?.lock_until ? new Date(row.lock_until).getTime() : 0;
    if (row?.lock_by && until > Date.now()) { await this.ctx.storage.setAlarm(until + 1000); return; }
    await this.ctx.storage.delete("lock");
    this.sendAll({ type: "editor", by: null });
  }

  private sendAll(msg: unknown) { this.send("viewer", msg); this.send("editor", msg); }

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
