/**
 * Reading the EXIF of a JPEG, the same way on every client (the Studio's import now, the phone's
 * camera from step B3): the raw tags by their EXIF names, as the photo route takes them
 * (docs/api.md), and what is read from them when a photo is added. No dependency: a full EXIF
 * library would be a large one for what a photo keeps. Never throws on a broken file.
 */
export type ExifValue = string | number | number[];
export type Exif = Record<string, ExifValue>;

/** The tags kept, by number. IFD0 and the EXIF IFD; GPS is not read (no position on photos, 01). */
const NAMES: Record<number, string> = {
  0x010f: "Make", 0x0110: "Model", 0x0112: "Orientation", 0x011a: "XResolution", 0x011b: "YResolution", 0x0131: "Software", 0x0132: "DateTime",
  0x829a: "ExposureTime", 0x829d: "FNumber", 0x8822: "ExposureProgram", 0x8827: "ISOSpeedRatings", 0x9003: "DateTimeOriginal", 0x9004: "DateTimeDigitized",
  0x9010: "OffsetTime", 0x9011: "OffsetTimeOriginal", 0x9201: "ShutterSpeedValue", 0x9202: "ApertureValue", 0x9204: "ExposureBiasValue", 0x9205: "MaxApertureValue",
  0x9207: "MeteringMode", 0x9209: "Flash", 0x920a: "FocalLength", 0x9291: "SubSecTimeOriginal", 0xa002: "PixelXDimension", 0xa003: "PixelYDimension",
  0xa20e: "FocalPlaneXResolution", 0xa20f: "FocalPlaneYResolution", 0xa210: "FocalPlaneResolutionUnit", 0xa402: "ExposureMode", 0xa403: "WhiteBalance",
  0xa404: "DigitalZoomRatio", 0xa405: "FocalLengthIn35mmFilm", 0xa406: "SceneCaptureType", 0xa431: "BodySerialNumber", 0xa432: "LensSpecification",
  0xa433: "LensMake", 0xa434: "LensModel",
};
const EXIF_IFD = 0x8769;
const SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

export function readExif(bytes: Uint8Array): Exif {
  const out: Exif = {};
  try {
    const app1 = findApp1(bytes);
    if (app1 < 0) return out;
    const tiff = app1 + 10; // "Exif\0\0" after the 2-byte length
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const le = view.getUint16(tiff) === 0x4949;
    const u16 = (at: number) => view.getUint16(at, le);
    const u32 = (at: number) => view.getUint32(at, le);
    const i32 = (at: number) => view.getInt32(at, le);
    const value = (type: number, at: number): number | null => {
      if (type === 3) return u16(at);
      if (type === 4) return u32(at);
      if (type === 9) return i32(at);
      if (type === 5) { const d = u32(at + 4); return d ? u32(at) / d : null; }
      if (type === 10) { const d = i32(at + 4); return d ? i32(at) / d : null; }
      if (type === 1 || type === 7) return bytes[at];
      return null;
    };
    const ifd = (start: number, visit: (tag: number, type: number, count: number, at: number) => void) => {
      const n = u16(start);
      for (let i = 0; i < n && i < 512; i++) {
        const e = start + 2 + i * 12;
        const type = u16(e + 2), count = u32(e + 4);
        const size = (SIZE[type] ?? 1) * count;
        visit(u16(e), type, count, size <= 4 ? e + 8 : tiff + u32(e + 8));
      }
    };
    const read = (tag: number, type: number, count: number, at: number) => {
      const name = NAMES[tag];
      if (!name || at + (SIZE[type] ?? 1) * count > bytes.length) return;
      if (type === 2) {
        let s = "";
        for (let i = 0; i < count && i < 500 && bytes[at + i] !== 0; i++) s += String.fromCharCode(bytes[at + i]);
        if (s.trim()) out[name] = s.trim();
      } else if (type !== 7 || count === 1) {
        const step = SIZE[type] ?? 1;
        const list = Array.from({ length: Math.min(count, 16) }, (_, i) => value(type, at + i * step)).filter((v): v is number => v !== null && Number.isFinite(v));
        if (list.length === 1) out[name] = list[0];
        else if (list.length > 1) out[name] = list;
      }
    };
    let exifIfd = 0;
    ifd(tiff + u32(tiff + 4), (tag, type, count, at) => { if (tag === EXIF_IFD) exifIfd = u32(at); else read(tag, type, count, at); });
    if (exifIfd) ifd(tiff + exifIfd, read);
  } catch { /* truncated or odd file: keep what was read */ }
  return out;
}

/** Offset of the Exif APP1 segment's marker, or -1. */
function findApp1(b: Uint8Array): number {
  if (b[0] !== 0xff || b[1] !== 0xd8) return -1;
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) return i;
    if (marker === 0xda) return -1; // image data starts: no EXIF before it
    i += 2 + len;
  }
  return -1;
}

/**
 * When the picture was taken, as ISO 8601 UTC: `DateTimeOriginal` with its offset when the camera
 * wrote one, else read as the local time of the client that adds it. Null when there is none.
 */
export function takenAt(exif: Exif): string | null {
  const raw = typeof exif.DateTimeOriginal === "string" ? exif.DateTimeOriginal : typeof exif.DateTime === "string" ? exif.DateTime : null;
  const m = raw && /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) return null;
  const offset = typeof exif.OffsetTimeOriginal === "string" && /^[+-]\d{2}:\d{2}$/.test(exif.OffsetTimeOriginal) ? exif.OffsetTimeOriginal : "";
  const t = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset}`);
  return Number.isNaN(t.getTime()) || t.getUTCFullYear() < 1900 ? null : t.toISOString();
}

/** The device and lens as a person reads them. */
export function readoutOf(exif: Exif): { make?: string; model?: string; lens?: string } {
  const s = (v: ExifValue | undefined) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const make = s(exif.Make), model = s(exif.Model), lens = s(exif.LensModel);
  return { ...(make ? { make } : {}), ...(model ? { model: make && model.startsWith(make) ? model.slice(make.length).trim() || model : model } : {}), ...(lens ? { lens } : {}) };
}

/** Width and height as the photo is shown, given the stored size and the EXIF orientation (5–8 are on their side). */
export const uprightSize = (w: number, h: number, orientation: ExifValue | undefined) =>
  typeof orientation === "number" && orientation >= 5 && orientation <= 8 ? { width: h, height: w } : { width: w, height: h };
