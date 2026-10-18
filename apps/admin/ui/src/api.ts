/** The admin Worker's API (apps/admin/src/index.ts); same origin, behind its own Cloudflare Access app. */

export interface Overview { users: number; blocked: number; active_30d: number; workspaces: number; projects: number; shots: number; photos: number; bytes: number; unsized: number }
export interface AdminUser { id: string; email: string; name: string | null; status: "active" | "blocked"; created_at: string; locked_until: string | null; no_password: boolean; sessions: number; last_seen: string | null; workspaces: number }
export interface AdminWorkspace { id: string; name: string; kind: "personal" | "shared"; created_at: string; owner_email: string | null; members: number; projects: number; shots: number; photos: number; bytes: number; unsized: number }

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, credentials: "same-origin", headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) } });
  // Access sends its login page when the session ran out: go through it again.
  if (res.redirected) { location.reload(); throw new ApiError(401, "signed out"); }
  const body = (await res.json().catch(() => null)) as ({ error?: string } & T) | null;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
  return body as T;
}
const send = <T,>(method: string, path: string, body?: unknown) => request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const whoami = () => request<{ email: string }>("/api/whoami").then((r) => r.email);
export const fetchOverview = () => request<{ overview: Overview }>("/api/overview").then((r) => r.overview);
export const fetchUsers = () => request<{ users: AdminUser[] }>("/api/users").then((r) => r.users);
export const fetchWorkspaces = () => request<{ workspaces: AdminWorkspace[] }>("/api/workspaces").then((r) => r.workspaces);
export const createUser = (email: string, name: string | null) => send<{ user: { id: string; email: string }; password: string }>("POST", "/api/users", { email, name });
export const patchUser = (id: string, patch: { email?: string; name?: string | null; status?: "active" | "blocked" }) => send<unknown>("PATCH", `/api/users/${id}`, patch);
export const resetPassword = (id: string) => send<{ password: string }>("POST", `/api/users/${id}/password`).then((r) => r.password);
export const deleteUser = (id: string) => send<unknown>("DELETE", `/api/users/${id}`);
