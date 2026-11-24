/** Same-origin API (docs/api.md); the session cookie is sent automatically. */
import type { FrameValues } from "@openclapper/model";

export interface Me { user: { id: string; email: string; name: string | null }; workspaces: { id: string; name: string; role: WorkspaceRole; personal: boolean }[] }
export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export interface Project { id: string; name: string; workspace_id: string; created_at: string; updated_at: string | null; file_count: number; canvas_live: CanvasLive; /** The master timeline: the order of the project's timelines. */ master: string[]; /** The extensions switched on (docs/rewrite/08-extensions.md). */ extensions: string[] }
/** How watchers of a canvas see it change while someone edits it: at once, or every few seconds. */
export type CanvasLive = "realtime" | "gradual";
export interface ServerBuild { version: string; commit: string; instance: string }

/** An API answer that is not 2xx: the server's message and status, plus what else its body carried. */
export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let onUnauthorized = () => {};
/** Called when any request answers 401: the session ended, so the shell shows the sign-in page again. */
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "The server cannot be reached");
  }
  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError(401, "Signed out");
  }
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { /* not JSON: a proxy's error page */ }
  if (!res.ok) throw new ApiError(res.status, typeof body.error === "string" ? body.error : `Request failed (${res.status})`, body);
  return body as T;
}

export const get = <T>(path: string) => request<T>(path);
export const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

export const fetchServerBuild = () => get<ServerBuild & { ok: true }>("/api/ping");

/** Who this browser is, or null when nobody is signed in. */
export async function fetchMe(): Promise<Me | null> {
  const res = await fetch("/api/me", { credentials: "same-origin" }).catch(() => null);
  if (!res) throw new ApiError(0, "The server cannot be reached");
  if (res.status === 401) return null;
  if (!res.ok) throw new ApiError(res.status, `Request failed (${res.status})`);
  return (await res.json()) as Me;
}

export const signIn = (email: string, password: string) => send<unknown>("POST", "/api/auth/login", { email, password, client: "studio" }).then(() => undefined);
export const signOut = () => fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).then(() => undefined);

export const fetchProjects = () => get<{ projects: Project[] }>("/api/projects").then((r) => r.projects);
export const putProject = (id: string, body: { name: string; workspace_id?: string; canvas_live?: CanvasLive; master?: string[]; extensions?: string[] }) => send<{ project: Project }>("PUT", `/api/projects/${id}`, body).then((r) => r.project);
export const deleteProject = (id: string) => send<{ deleted: string }>("DELETE", `/api/projects/${id}`);

/** A file as the API gives it (docs/api.md). `body` and `refs` come with single-file answers and with lists that ask for them. */
export interface FileRec {
  id: string; project_id: string | null; home: boolean; type: string; name: string; container: string | null; internal_of: string | null; fixed: string | null;
  created_at: string; updated_at: string | null; created_by: string | null; deleted_at: string | null; lock: { by: string | null; until: string } | null;
  body_version: number; body?: Record<string, unknown>; refs?: FileRef[]; binned_with?: number;
  /** A photo's facts; absent on any other file. */
  photo?: PhotoFacts;
  /** Property values by definition id (lists read with values=1, single files always). */
  values?: Record<string, unknown>;
}
export interface PhotoFacts {
  origin: "capture" | "import"; media_type: string; taken_at: string; width: number; height: number;
  /** The frame it was taken with (the camera's, a fact): frame values, a preset's factors copied with its name. */
  frame?: (FrameValues & { presetName?: string }) | null;
  /** Bytes of each stored image; null until it arrived. */
  stored: { thumbnail: number | null; preview: number | null; original: number | null };
  angle_of_view: { horizontal: number; vertical: number; source: "exif-35mm" | "exif-sensor" } | null;
  device_id: string | null;
}
export interface FileRef { kind: string; to: string; data: Record<string, unknown> | null; missing?: boolean }
export interface FileUse { id: string; type: string; name: string; internal_of: string | null; kind: string }

/** A root of files: a project, or the signed-in person's account home. */
export type Root = { project: string } | "home";
export const rootQuery = (r: Root) => (r === "home" ? "home=1" : `project_id=${r.project}`);
const rootBody = (r: Root) => (r === "home" ? { home: true } : { project_id: r.project });

/** Every live file of a root, internal files too (each list shows them only inside their parent). */
export const fetchFiles = (r: Root) => get<{ files: FileRec[] }>(`/api/files?${rootQuery(r)}&body=1&refs=1&values=1&internal=1`).then((x) => x.files);
/** Property values of one file (null removes one) → the file's values after. */
export const putValues = (id: string, values: Record<string, unknown>) => send<{ values: Record<string, unknown> }>("PUT", `/api/files/${id}/properties`, { values }).then((x) => x.values);
/** The same values on many files (bulk edit). */
export const setValuesOn = (ids: string[], values: Record<string, unknown>) => send<unknown>("POST", "/api/properties/set", { ids, values });
export const fetchBin = (r: Root) => get<{ files: FileRec[] }>(`/api/files?${rootQuery(r)}&bin=1`).then((x) => x.files);
/** Make an internal file a file of its root (one-way): at the top level, or in a container. */
export const releaseFile = (id: string, container: string | null = null) => send<{ file: FileRec }>("POST", `/api/files/${id}/release`, { container }).then((x) => x.file);
export const fetchUses = (id: string) => get<{ uses: FileUse[] }>(`/api/files/${id}/uses`).then((x) => x.uses);
export const putFile = (id: string, body: Record<string, unknown>) => send<{ file: FileRec }>("PUT", `/api/files/${id}`, body).then((x) => x.file);
export const createFile = (r: Root, id: string, body: Record<string, unknown>) => putFile(id, { ...rootBody(r), ...body });
export const moveFiles = (ids: string[], container: string | null) => send<unknown>("POST", "/api/files/move", { ids, container });
export const binFiles = (ids: string[]) => send<unknown>("POST", "/api/files/bin", { ids });
export const restoreFiles = (ids: string[]) => send<{ restored: string[]; to_top: string[] }>("POST", "/api/files/restore", { ids });
export const purgeFiles = (ids: string[]) => send<unknown>("POST", "/api/files/purge", { ids });
export const emptyBin = (r: Root) => send<{ purged: number }>("DELETE", `/api/bin?${rootQuery(r)}`);
export const duplicateFile = (id: string, body: { id: string; name?: string; container?: string | null }) => send<{ file: FileRec }>("POST", `/api/files/${id}/duplicate`, body).then((x) => x.file);

export interface Workspace { id: string; name: string; role: WorkspaceRole; personal: boolean; member_count: number; project_count: number; created_at: string }
export interface Member { user_id: string; email: string; name: string | null; role: WorkspaceRole; created_at: string }
export const fetchWorkspaces = () => get<{ workspaces: Workspace[] }>("/api/workspaces").then((r) => r.workspaces);
export const putWorkspace = (id: string, name: string) => send<unknown>("PUT", `/api/workspaces/${id}`, { name });
export const fetchMembers = (workspaceId: string) => get<{ members: Member[] }>(`/api/workspaces/${workspaceId}/members`).then((r) => r.members);
export const putMember = (workspaceId: string, email: string, role: Exclude<WorkspaceRole, "owner">) => send<unknown>("POST", `/api/workspaces/${workspaceId}/members`, { email, role });
export const deleteMember = (workspaceId: string, userId: string) => send<unknown>("DELETE", `/api/workspaces/${workspaceId}/members/${userId}`);
/** 204 on success; a wrong current password is 403 (not 401, which would read as signed out). */
export const changePassword = (current: string, password: string) => send<unknown>("POST", "/api/auth/password", { current, password });

// ---------- Canvases and the edit lock (docs/features/canvas.md) ----------

export interface Lock { by: string; until: string }
/** Takes or renews the edit lock for an editing window; null when someone else holds it (with who). */
export async function takeLock(id: string, holder: string): Promise<{ ok: true; lock: Lock } | { ok: false; lock: Lock }> {
  try { return { ok: true, lock: (await send<{ lock: Lock }>("POST", `/api/files/${id}/lock`, { holder })).lock }; }
  catch (e) { if (e instanceof ApiError && e.status === 423) return { ok: false, lock: e.body.lock as Lock }; throw e; }
}
/** Lets go of the lock; sent with keepalive so it also goes out while the page closes. */
export const releaseLock = (id: string, holder: string) =>
  fetch(`/api/files/${id}/lock?holder=${encodeURIComponent(holder)}`, { method: "DELETE", credentials: "same-origin", keepalive: true }).then(() => undefined, () => undefined);
/** A save that holds the lock: the window's token goes along. */
export const putFileLocked = (id: string, body: Record<string, unknown>, holder: string) =>
  request<{ file: FileRec }>(`/api/files/${id}`, { method: "PUT", headers: { "content-type": "application/json", "x-lock-holder": holder }, body: JSON.stringify(body) }).then((x) => x.file);
/** A canvas's render or thumbnail. */
export const putRender = (id: string, part: "render" | "thumbnail", image: Blob, holder: string) =>
  request<{ file: FileRec }>(`/api/canvases/${id}/${part}`, { method: "PUT", headers: { "content-type": image.type || "application/octet-stream", "x-lock-holder": holder }, body: image }).then((x) => x.file);
/** Where a canvas's render or thumbnail is, versioned by the file's last change so a new one is fetched. */
export const renderUrl = (f: Pick<FileRec, "id" | "updated_at" | "created_at">, size: "render" | "thumbnail" = "render") => `/api/canvases/${f.id}/image?size=${size}&v=${encodeURIComponent(f.updated_at ?? f.created_at)}`;
