/** The public liveness probe: which version, commit and instance run (docs/api.md, docs/releasing.md). */
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { publicRouter } from "../../src/routes.ts";
import { api, ok } from "./helpers.ts";

describe("GET /api/ping", () => {
  test("answers without a session and names no instance on production", async () => {
    const body = await ok<{ ok: boolean; version: string; commit: string; instance: string }>(api(null, "GET", "/api/ping"));
    expect(body).toMatchObject({ ok: true, instance: "" });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("names the instance when INSTANCE_LABEL is set (staging)", async () => {
    const url = new URL("http://localhost/api/ping");
    const res = await publicRouter.handle("GET", url.pathname, { request: new Request(url), env: { ...env, INSTANCE_LABEL: "staging" }, url });
    expect(await res.json()).toMatchObject({ instance: "staging" });
  });
});
