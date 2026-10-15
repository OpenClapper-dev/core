/**
 * The few EXIF tags the app reads from a captured JPEG (issue #26). vision-camera hands over the
 * encoded file but not its EXIF, and the calibration needs FocalLengthIn35mmFilm; a full EXIF library
 * would be a dependency for five tags. Returns what it finds; never throws on a broken file.
 */
export interface ExifTags {
  Make?: string;
  Model?: string;
  /** 1 = upright; 5–8 = stored rotated by 90° (width and height swapped when shown). */
  Orientation?: number;
  FocalLength?: number;
  FocalLengthIn35mmFilm?: number;
}

const TAGS: Record<number, keyof ExifTags> = { 0x010f: "Make", 0x0110: "Model", 0x0112: "Orientation", 0x920a: "FocalLength", 0xa405: "FocalLengthIn35mmFilm" };
const EXIF_IFD = 0x8769;

export function readExif(bytes: Uint8Array): ExifTags {
  const out: ExifTags = {};
  try {
    const app1 = findApp1(bytes);
    if (app1 < 0) return out;
    const tiff = app1 + 10; // "Exif\0\0" after the 2-byte length
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const le = view.getUint16(tiff) === 0x4949;
    const u16 = (at: number) => view.getUint16(at, le);
    const u32 = (at: number) => view.getUint32(at, le);
    const ifd = (start: number, visit: (tag: number, type: number, count: number, valueAt: number) => void) => {
      const n = u16(start);
      for (let i = 0; i < n; i++) {
        const e = start + 2 + i * 12;
        const type = u16(e + 2), count = u32(e + 4);
        const size = ([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8][type] ?? 1) * count;
        visit(u16(e), type, count, size <= 4 ? e + 8 : tiff + u32(e + 8));
      }
    };
    const read = (tag: number, type: number, count: number, at: number) => {
      const key = TAGS[tag];
      if (!key) return;
      if (type === 2) {
        let s = "";
        for (let i = 0; i < count && bytes[at + i] !== 0; i++) s += String.fromCharCode(bytes[at + i]);
        (out as Record<string, unknown>)[key] = s.trim();
      } else if (type === 3) (out as Record<string, unknown>)[key] = u16(at);
      else if (type === 4) (out as Record<string, unknown>)[key] = u32(at);
      else if (type === 5) { const d = u32(at + 4); if (d) (out as Record<string, unknown>)[key] = u32(at) / d; }
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

/** Width and height as the photo is shown, given the stored size and the EXIF orientation. */
export const uprightSize = (w: number, h: number, orientation: number | undefined) => (orientation && orientation >= 5 && orientation <= 8 ? { width: h, height: w } : { width: w, height: h });
