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

// ---------- Storage monitoring (epic #67) ----------
export interface Mark { bytes: number; label: string }
export interface StorageDay { day: string; total_bytes: number; total_objects: number; workspaces: { workspace_id: string; bytes: number; objects: number; unsized: number }[] }
export interface StorageReport {
  total: { bytes: number; objects: number; day: string } | null;
  workspaces: { id: string; name: string; kind: "personal" | "shared"; owner_email: string | null; photos: number; bytes: number; unsized: number }[];
  days: StorageDay[];
  marks: Mark[];
  crossed: Mark[];
}
export const fetchStorage = (days: number) => request<StorageReport>(`/api/storage?days=${days}`);
export const putMarks = (marks: Mark[]) => send<{ storage_marks: Mark[] }>("PUT", "/api/settings", { storage_marks: marks }).then((r) => r.storage_marks);

// ---------- The optional Cloudflare overlay (#217) ----------
export interface Dataset<T> { data: T | null; error: string | null }
export interface CfOverlay {
  configured: true; fetched_at: string; cached: boolean; days: number;
  r2: Dataset<{ buckets: { name: string; bytes: number; metadata_bytes: number; objects: number; app: boolean }[]; total_bytes: number; series: { day: string; value: number }[] }>;
  r2_ops: Dataset<{ class_a: number; class_b: number; by_action: { action: string; requests: number }[] }>;
  worker: Dataset<{ requests: number; errors: number; subrequests: number; cpu_p50_us: number | null; cpu_p99_us: number | null; series: { day: string; requests: number; errors: number }[] }>;
  d1: Dataset<{ rows_read: number; rows_written: number; read_queries: number; write_queries: number; series: { day: string; rows_read: number; rows_written: number }[] }>;
  history: { day: string; metric: string; value: number }[];
}
export const fetchCloudflare = (days: number) => request<CfOverlay | { configured: false }>(`/api/cloudflare?days=${days}`);
