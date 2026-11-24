import { File, UploadType } from "expo-file-system";
import { getSession, getToken, setSession } from "./auth";
import { API_URL, isConfigured } from "./config";
import { log } from "./log";
import { isOfflineMode, markOnline } from "./net";

/**
 * The phone's client of the Worker (docs/api.md): sign-in, projects, files, photos, devices. Every
 * request carries the session as a bearer token; a 401 ends the session on the phone (the app then
 * shows the sign-in gate, nothing queued is lost).
 */
export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown = null) {
    super(message);
  }
}

/** The session token as a bearer header (every request, images included). */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}`, ...extra } : { ...extra };
}

/** A web page instead of the API: a Wi-Fi login page, or a login proxy in front of the server. Neither means the session is gone. */
function isWebPage(res: Response): boolean {
  return res.redirected || (res.headers.get("content-type") ?? "").includes("text/html") || (!!res.url && !res.url.startsWith(API_URL));
}
const WEB_PAGE = "the server answered with a web page (a Wi-Fi login?)";

/** Whether a request can be made at all: configured, signed in, not in offline mode. */
export const canCall = () => isConfigured && !isOfflineMode() && !!getToken();

/** One request; `body` is sent as JSON. */
export async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!isConfigured) throw new ApiError(0, "API not configured in this build");
  if (isOfflineMode()) throw new ApiError(0, "offline mode is on");
  if (!getToken()) throw new ApiError(401, "not signed in");
  const started = Date.now();
  const method = init.method ?? "GET";
  const headers = authHeaders(init.body === undefined ? {} : { "content-type": "application/json" });
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch (err) {
    log("warn", "api network error", { method, path, ms: Date.now() - started, error: err });
    markOnline(false);
    throw err;
  }
  markOnline(true);
  log(res.ok ? "debug" : "warn", "api", { method, path, status: res.status, ms: Date.now() - started });
  if (res.status === 401) {
    setSession(null);
    throw new ApiError(401, "session expired, please sign in again");
  }
  if (isWebPage(res)) throw new ApiError(0, WEB_PAGE);
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? `HTTP ${res.status}`, body);
  return body as T;
}

/** A rejection by the server (4xx but not 401/408/429): sending it again unchanged will not help. */
export const isRejection = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status);

// ---------- Sign-in ----------

/** Sign in with email and password. Not through call(): there is no session yet, and a 401 here is a wrong password. */
export async function signIn(email: string, password: string): Promise<void> {
  if (!isConfigured) throw new ApiError(0, "API not configured in this build");
  const res = await fetch(`${API_URL}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ email, password, client: "mobile" }) });
  if (isWebPage(res)) throw new ApiError(0, WEB_PAGE);
  const body = (await res.json().catch(() => null)) as { token?: string; user?: { id: string; email: string }; error?: string } | null;
  if (!res.ok || !body?.token || !body.user) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`, body);
  log("info", "signed in", { email: body.user.email });
  setSession({ token: body.token, email: body.user.email, userId: body.user.id });
}

/** Changes the password; every other session of the account ends, this one stays. A wrong current password is a 403. */
export const changePassword = (current: string, password: string) => call<null>("/api/auth/password", { method: "POST", body: { current, password } });

/** Ends the session on the server (best effort: offline, the token just stays unused) and on the phone. */
export async function signOut(): Promise<void> {
  const session = getSession();
  setSession(null);
  if (session && isConfigured) await fetch(`${API_URL}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${session.token}` } }).catch(() => {});
}

export interface Me { user: { id: string; email: string; name: string }; workspaces: { id: string; name: string; role: string; personal: boolean }[] }
export const me = () => call<Me>("/api/me");

// ---------- Projects ----------

export interface Project { id: string; name: string; workspace_id: string; created_at: string; updated_at: string; file_count: number }
export const listProjects = () => call<{ projects: Project[] }>("/api/projects").then((r) => r.projects);
/** A new project (or a rename). A name taken in the workspace is a 409 with `existing_id`. */
export const putProject = (id: string, name: string) => call<{ project: Project }>(`/api/projects/${id}`, { method: "PUT", body: { name } });

// ---------- Files ----------

/** A photo's facts as file answers carry them (docs/api.md, Files). */
export interface PhotoFacts {
  origin: "capture" | "import"; media_type: string | null; taken_at: string | null; width: number; height: number;
  stored: { thumbnail: number | null; preview: number | null; original: number | null };
  angle_of_view: { horizontal: number; vertical: number; source: string } | null; device_id: string | null;
}
export interface FileRec {
  id: string; project_id: string | null; type: string; name: string; container: string | null; internal_of: string | null; fixed: string | null;
  created_at: string; updated_at: string; created_by: string | null; deleted_at: string | null;
  body_version: number; body?: Record<string, unknown>; photo?: PhotoFacts;
}
export type Root = { project_id: string } | { home: true };
const rootQuery = (r: Root) => ("home" in r ? "home=1" : `project_id=${encodeURIComponent(r.project_id)}`);

/** The live files of a root, every page of them. */
export async function listFiles(root: Root, q: { type?: string; container?: string; body?: boolean } = {}): Promise<FileRec[]> {
  const out: FileRec[] = [];
  for (let offset = 0; ; ) {
    const params = [rootQuery(root), q.type && `type=${q.type}`, q.container && `container=${q.container}`, q.body && "body=1", "limit=2000", `offset=${offset}`].filter(Boolean).join("&");
    const page = await call<{ files: FileRec[]; more: boolean }>(`/api/files?${params}`);
    out.push(...page.files);
    if (!page.more || !page.files.length) return out;
    offset += page.files.length;
  }
}
export const getFile = (id: string) => call<{ file: FileRec }>(`/api/files/${id}`).then((r) => r.file);
export const putFile = (id: string, f: Partial<Pick<FileRec, "name" | "container" | "body">> & { type: string } & ({ project_id: string } | { home: true })) =>
  call<{ file: FileRec }>(`/api/files/${id}`, { method: "PUT", body: f }).then((r) => r.file);
export const moveFiles = (ids: string[], container: string | null) => call<unknown>("/api/files/move", { method: "POST", body: { ids, container } });
export const binFiles = (ids: string[]) => call<unknown>("/api/files/bin", { method: "POST", body: { ids } });

// ---------- Photos ----------

export type ImageSize = "thumbnail" | "preview" | "original";
export interface PhotoMeta {
  project_id: string; origin: "capture" | "import"; media_type?: string; taken_at?: string; width: number; height: number;
  name?: string; container?: string | null; exif?: Record<string, unknown>; readout?: Record<string, string>; device_id?: string | null;
}
/** What is known about a photo; idempotent (sent again, nothing changes). */
export const putPhoto = (id: string, meta: PhotoMeta) => call<{ file: FileRec }>(`/api/photos/${id}`, { method: "PUT", body: meta }).then((r) => r.file);
/**
 * One of a photo's images, a file on the phone sent as it is by the native uploader (streamed from
 * disk, also for a large original); stored once, a second upload answers `already`. Answers as call().
 */
export async function putPhotoPart(id: string, part: ImageSize, file: File, type: string): Promise<void> {
  if (!isConfigured) throw new ApiError(0, "API not configured in this build");
  if (isOfflineMode()) throw new ApiError(0, "offline mode is on");
  if (!getToken()) throw new ApiError(401, "not signed in");
  const path = `/api/photos/${id}/${part}`;
  const started = Date.now();
  let res: { status: number; body: string };
  try {
    res = await file.upload(`${API_URL}${path}`, { httpMethod: "PUT", uploadType: UploadType.BINARY_CONTENT, headers: authHeaders({ "content-type": type }) });
  } catch (err) {
    log("warn", "upload network error", { path, ms: Date.now() - started, error: err });
    markOnline(false);
    throw err;
  }
  markOnline(true);
  log(res.status < 400 ? "debug" : "warn", "upload", { path, status: res.status, ms: Date.now() - started, bytes: file.size });
  if (res.status === 401) { setSession(null); throw new ApiError(401, "session expired, please sign in again"); }
  if (res.status >= 400) {
    let msg = `HTTP ${res.status}`;
    try { msg = (JSON.parse(res.body) as { error?: string }).error ?? msg; } catch { /* not JSON */ }
    throw new ApiError(res.status, msg);
  }
}
/** Where an image of a photo is; load it with `authHeaders()`. */
export const imageUrl = (id: string, size: ImageSize = "preview") => `${API_URL}/api/photos/${id}/image?size=${size}`;

// ---------- Devices ----------

export interface DeviceReport {
  fingerprint: string; kind: "phone" | "tablet"; make: string; model: string;
  lenses: { id: string; name: string; focal35: number | null; zoom: number | null }[];
  screen: { portrait: { w: number; h: number }; landscape: { w: number; h: number } } | null; app: string;
}
export const registerDevice = (r: DeviceReport) => call<{ file: FileRec }>("/api/devices/register", { method: "POST", body: r }).then((x) => x.file);
