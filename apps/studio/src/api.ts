/** Same-origin API (docs/api.md); the session cookie is sent automatically. */

export interface Me { user: { id: string; email: string; name: string | null }; workspaces: { id: string; name: string; role: WorkspaceRole; personal: boolean }[] }
export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
export interface Project { id: string; name: string; workspace_id: string; created_at: string; updated_at: string | null; file_count: number }
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
export const putProject = (id: string, body: { name: string; workspace_id?: string }) => send<{ project: Project }>("PUT", `/api/projects/${id}`, body).then((r) => r.project);
export const deleteProject = (id: string) => send<{ deleted: string }>("DELETE", `/api/projects/${id}`);
