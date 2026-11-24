import { ColorChooser, CollectionTag, PropertyRow, PropertySection, Segmented } from "@openclapper/design";
import type { FileRec } from "./api";
import { bodyOf, collectionOf, photosOf, setColor, setOrder, tintOf } from "./collections";
import { imageUrl } from "./media";

const bytes = (n: number | null) => (n == null ? "not yet" : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const deg = (n: number) => `${n.toFixed(1)}°`;
const kindName: Record<string, string> = { "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP", "image/heic": "HEIC" };

/** A photo's facts (docs/rewrite/01-media.md): read-only properties, with the raw EXIF folded away. */
export function PhotoFactsSections({ f, map }: { f: FileRec; map: ReadonlyMap<string, FileRec> }) {
  const p = f.photo;
  if (!p) return null;
  const readout = (f.body?.readout ?? {}) as { make?: string; model?: string; lens?: string };
  const exif = Object.entries((f.body?.exif ?? {}) as Record<string, unknown>);
  const coll = collectionOf(f, map);
  return (
    <>
      <PropertySection title="Photo" icon="image">
        <PropertyRow label="Taken" value={when(p.taken_at)} />
        <PropertyRow label="Size" value={`${p.width} × ${p.height}`} unit="px" numeric />
        <PropertyRow label="Angle of view" value={p.angle_of_view ? `${deg(p.angle_of_view.horizontal)} × ${deg(p.angle_of_view.vertical)}` : "unknown"} numeric={!!p.angle_of_view} />
        {p.angle_of_view && <PropertyRow label="From" value={p.angle_of_view.source === "exif-35mm" ? "EXIF, 35 mm equivalent" : "EXIF, focal length and sensor"} />}
        {coll && <PropertyRow label="Collection"><CollectionTag tint={tintOf(coll)!}>{coll.name}</CollectionTag></PropertyRow>}
      </PropertySection>
      <PropertySection title="Device" icon="camera">
        <PropertyRow label="Camera" value={[readout.make, readout.model].filter(Boolean).join(" ") || "unknown"} />
        {readout.lens && <PropertyRow label="Lens" value={readout.lens} />}
        <PropertyRow label="Came in by" value={p.origin === "capture" ? "the camera" : "an import"} />
      </PropertySection>
      <PropertySection title="Stored" icon="database" defaultOpen={false}>
        <PropertyRow label="Original" value={`${kindName[p.media_type] ?? p.media_type} · ${bytes(p.stored.original)}`} />
        <PropertyRow label="Preview" value={bytes(p.stored.preview)} />
        <PropertyRow label="Thumbnail" value={bytes(p.stored.thumbnail)} />
      </PropertySection>
      {exif.length > 0 && (
        <PropertySection title={`EXIF · ${exif.length}`} icon="file-text" defaultOpen={false}>
          {exif.map(([k, v]) => <PropertyRow key={k} label={k} value={Array.isArray(v) ? v.map((x) => +Number(x).toFixed(4)).join(", ") : typeof v === "number" ? String(+v.toFixed(6)) : String(v)} overflow="truncate" />)}
        </PropertySection>
      )}
    </>
  );
}

/** A collection's own settings: how many it holds, its colour, its order. */
export function CollectionSections({ c, files }: { c: FileRec; files: readonly FileRec[] }) {
  const b = bodyOf(c);
  return (
    <>
      <PropertySection title="Collection" icon="layers">
        <PropertyRow label="Photos" value={String(photosOf(c, files).length)} numeric />
        <PropertyRow label="Order"><Segmented label="Order" value={b.order} onChange={(v) => void setOrder(c, files, v as "time" | "manual")} options={[{ value: "time", label: "By time" }, { value: "manual", label: "By hand" }]} /></PropertyRow>
      </PropertySection>
      <PropertySection title="Colour" icon="palette">
        <div className="st-pad"><ColorChooser value={b.color} label="Collection colour" onChange={(col) => void setColor(c, col)} /></div>
        <p className="st-note st-pad">Given at random when the collection is made, and stored with it: everyone sees the same colour.</p>
      </PropertySection>
    </>
  );
}

/** The picture that stands for a file: a photo's own thumbnail, a collection's first photo; null for anything else. */
export function thumbOf(f: FileRec, files: readonly FileRec[]): string | null {
  if (f.type === "photo") return f.photo?.stored.thumbnail ? imageUrl(f.id, "thumbnail") : null;
  if (f.type === "collection") { const first = photosOf(f, files).find((x) => x.photo?.stored.thumbnail); return first ? imageUrl(first.id, "thumbnail") : null; }
  return null;
}
