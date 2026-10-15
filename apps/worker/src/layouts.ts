import { validateViewfinderLayout, type ViewfinderLayout } from "@fielder/vocab";
import { assertString, assertUuid, HttpError, json, readJson, type Router } from "./http.ts";
import type { Ctx } from "./index.ts";

interface LayoutRow { id: string; name: string; layout: string; created_at: string; updated_at: string | null }
const toApi = (r: LayoutRow) => ({ ...r, layout: JSON.parse(r.layout) as ViewfinderLayout });

/** Viewfinder layouts (issue #49): edited on the dashboard, read by the phone. Client-owned UUIDs, upserts. */
export function registerLayoutRoutes(r: Router<Ctx>) {
  r.on("GET", "/api/viewfinder-layouts", async ({ env }) => {
    const { results } = await env.DB.prepare("SELECT * FROM viewfinder_layouts ORDER BY name COLLATE NOCASE").all<LayoutRow>();
    return json({ layouts: results.map(toApi) });
  });

  /** JSON { name, layout }, the layout checked strictly (validateViewfinderLayout). */
  r.on("PUT", "/api/viewfinder-layouts/:id", async ({ env, request }, { id }) => {
    const lid = assertUuid(id, "id");
    const b = await readJson<Record<string, unknown>>(request);
    const name = assertString(b.name, "name", 80);
    const err = validateViewfinderLayout(b.layout);
    if (err) throw new HttpError(400, err);
    const layout = JSON.stringify(b.layout);
    if (layout.length > 16 * 1024) throw new HttpError(413, "layout too large");
    await env.DB.prepare(
      `INSERT INTO viewfinder_layouts (id, name, layout, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(id) DO UPDATE SET name = ?2, layout = ?3, updated_at = ?4`,
    ).bind(lid, name, layout, new Date().toISOString()).run();
    const row = await env.DB.prepare("SELECT * FROM viewfinder_layouts WHERE id = ?1").bind(lid).first<LayoutRow>();
    return json({ layout: toApi(row!) });
  });

  // A phone using a deleted layout falls back to the default on its next sync.
  r.on("DELETE", "/api/viewfinder-layouts/:id", async ({ env }, { id }) => {
    const lid = assertUuid(id, "id");
    const res = await env.DB.prepare("DELETE FROM viewfinder_layouts WHERE id = ?1").bind(lid).run();
    if (!res.meta.changes) throw new HttpError(404, "layout not found");
    return json({ deleted: lid });
  });
}
