/**
 * The R2 objects' custom metadata (#255): what each one should carry, and a repair for objects that lost
 * it. The app writes it on upload (apps/worker/src/shots.ts: shot_id, photo_id, workspace_id;
 * compose.ts: kind, id), as a second record of ownership on the object itself. A bucket copied without
 * metadata (the reference instance's rename, 2026-10-20; a clone with rclone, which adds mtime/btime)
 * leaves objects bare; the repair derives the metadata again from D1 and the keys.
 */

export type ObjectMetadata = Record<string, string>;

/** One page of a repair: what was looked at and what was (or, in a check, would be) rewritten. */
export interface RepairPage {
  checked: number;
  /** Objects whose metadata was missing or different: rewritten, or only counted in a check. */
  repaired: number;
  /** Objects the app does not know: no photo row for the key, or a key outside photos/ and renders/. */
  unknown: number;
  /** A few repaired or unknown keys, for the operator to look at. */
  examples: { key: string; reason: "missing" | "different" | "unknown" }[];
  /** Where the next page starts; null after the last one. */
  cursor: string | null;
}

/** Objects per call: each may take a get and a put, well inside a Worker request's limits. */
export const PAGE = 100;

interface PhotoRow { k: string; photo_id: string; shot_id: string; workspace_id: string | null }

/**
 * The metadata an object should carry: a photo's from its row (the workspace through its shot's
 * project), a render's from its key (renders/<kind>/<id>.<ext>). Null for an object the app does not know.
 */
export function expectedMetadata(key: string, photo: PhotoRow | undefined): ObjectMetadata | null {
  if (key.startsWith("photos/")) {
    if (!photo || !photo.workspace_id) return null;
    return { shot_id: photo.shot_id, photo_id: photo.photo_id, workspace_id: photo.workspace_id };
  }
  const render = key.match(/^renders\/(overlays|sketches)\/([^/]+)\.[a-z0-9]+$/);
  return render ? { kind: render[1], id: render[2] } : null;
}

const same = (a: ObjectMetadata, b: ObjectMetadata) => {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

/**
 * One page of the bucket: every object whose metadata is not exactly what it should be is rewritten in
 * place (the same body and content type, the derived metadata), unless `check` only counts them.
 * Unknown objects are left alone.
 */
export async function repairPage(db: D1Database, bucket: R2Bucket, cursor: string | null, check: boolean): Promise<RepairPage> {
  const listed = await bucket.list({ limit: PAGE, cursor: cursor ?? undefined, include: ["customMetadata"] });
  const photoKeys = listed.objects.map((o) => o.key).filter((k) => k.startsWith("photos/"));
  const rows = photoKeys.length
    ? (await db.prepare(
        `SELECT p.r2_object_key AS k, p.id AS photo_id, p.shot_id, pr.workspace_id
           FROM photos p JOIN shots s ON s.id = p.shot_id JOIN projects pr ON pr.id = s.project_id
          WHERE p.r2_object_key IN (SELECT value FROM json_each(?1))`,
      ).bind(JSON.stringify(photoKeys)).all<PhotoRow>()).results
    : [];
  const byKey = new Map(rows.map((r) => [r.k, r]));
  const page: RepairPage = { checked: 0, repaired: 0, unknown: 0, examples: [], cursor: listed.truncated ? listed.cursor : null };
  for (const o of listed.objects) {
    page.checked++;
    const want = expectedMetadata(o.key, byKey.get(o.key));
    if (!want) {
      page.unknown++;
      if (page.examples.length < 10) page.examples.push({ key: o.key, reason: "unknown" });
      continue;
    }
    const has = o.customMetadata ?? {};
    if (same(has, want)) continue;
    page.repaired++;
    if (page.examples.length < 10) page.examples.push({ key: o.key, reason: Object.keys(has).length ? "different" : "missing" });
    if (check) continue;
    const obj = await bucket.get(o.key);
    if (!obj) continue; // deleted meanwhile
    await bucket.put(o.key, obj.body, { httpMetadata: obj.httpMetadata, customMetadata: want });
  }
  return page;
}
