export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

export async function readJson<T>(request: Request): Promise<T> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new HttpError(415, "expected application/json");
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function assertUuid(v: unknown, field: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(400, `${field} must be a UUID`);
  return v.toLowerCase();
}

export function assertNumber(v: unknown, field: string, opts: { min?: number; max?: number } = {}): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new HttpError(400, `${field} must be a number`);
  if (opts.min !== undefined && v < opts.min) throw new HttpError(400, `${field} must be >= ${opts.min}`);
  if (opts.max !== undefined && v > opts.max) throw new HttpError(400, `${field} must be <= ${opts.max}`);
  return v;
}

export function assertString(v: unknown, field: string, maxLen = 200): string {
  if (typeof v !== "string" || v.trim().length === 0) throw new HttpError(400, `${field} must be a non-empty string`);
  if (v.length > maxLen) throw new HttpError(400, `${field} too long`);
  return v.trim();
}

export function assertEnum<T extends readonly string[]>(v: unknown, field: string, list: T): T[number] {
  if (typeof v !== "string" || !(list as readonly string[]).includes(v)) throw new HttpError(400, `${field} must be one of: ${list.join(", ")}`);
  return v;
}

export function assertIsoTimestamp(v: unknown, field: string): string {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${field} must be an ISO 8601 timestamp`);
  return new Date(v).toISOString();
}

/** Minimal method+pattern router. Patterns use `:name` segments. */
export type Handler<Ctx> = (ctx: Ctx, params: Record<string, string>) => Promise<Response>;

export class Router<Ctx> {
  private routes: { method: string; parts: string[]; handler: Handler<Ctx> }[] = [];

  on(method: string, pattern: string, handler: Handler<Ctx>): this {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
    return this;
  }

  async handle(method: string, pathname: string, ctx: Ctx): Promise<Response> {
    if (method === "HEAD") method = "GET"; // the runtime strips the body for HEAD responses
    const segs = pathname.split("/").filter(Boolean);
    let pathMatched = false;
    for (const r of this.routes) {
      if (r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        if (r.parts[i].startsWith(":")) params[r.parts[i].slice(1)] = decodeURIComponent(segs[i]);
        else if (r.parts[i] !== segs[i]) { ok = false; break; }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return r.handler(ctx, params);
    }
    throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "method not allowed" : "not found");
  }
}
