// Fake project for the UX workshop U1 prototype (docs/rewrite/ux-plan.md). Nothing here is product data or product code:
// it only has to look like a real project so the file browser can be judged.
import type { IconName } from "@openclapper/design";

export type FileType = "folder" | "collection" | "photo" | "canvas" | "shot" | "set" | "location" | "timeline" | "filter" | "preset";

/** How each file type shows: label, glyph and categorical colour of its tile. Set and location icons are stand-ins. */
export const TYPES: Record<FileType, { label: string; plural: string; glyph: IconName; color: number; app: string }> = {
  folder: { label: "Folder", plural: "Folders", glyph: "folder", color: 5, app: "Files" },
  collection: { label: "Collection", plural: "Collections", glyph: "layers", color: 4, app: "Media" },
  photo: { label: "Photo", plural: "Photos", glyph: "image", color: 0, app: "Photo" },
  canvas: { label: "Canvas", plural: "Canvases", glyph: "brush", color: 2, app: "Canvas" },
  shot: { label: "Shot", plural: "Shots", glyph: "slate", color: 1, app: "Shot" },
  set: { label: "Set", plural: "Sets", glyph: "home", color: 7, app: "Set" },
  location: { label: "Location", plural: "Locations", glyph: "location", color: 3, app: "Location" },
  timeline: { label: "Timeline", plural: "Timelines", glyph: "timeline", color: 6, app: "Timeline" },
  filter: { label: "Filter", plural: "Filters", glyph: "filter", color: 8, app: "Files" },
  preset: { label: "Optics preset", plural: "Optics presets", glyph: "lens", color: 6, app: "Optics presets" },
};

export type FieldType = "text" | "long" | "number" | "yesno" | "choice" | "multi" | "date" | "reference" | "position";
export interface PropDef {
  id: string; name: string; type: FieldType; section?: string;
  options?: { value: string; color: number }[];
  /** For a reference: the file type it points at, and whether it holds several. */
  target?: FileType; many?: boolean;
  on: FileType[];
}

/** The project's property catalogue: the default template plus one property this project added (Status). */
export const PROPS: PropDef[] = [
  { id: "scene", name: "Scene", type: "text", section: "Script", on: ["shot"] },
  { id: "no", name: "Shot no.", type: "text", section: "Script", on: ["shot"] },
  { id: "set", name: "Set", type: "reference", target: "set", section: "Script", on: ["shot"] },
  { id: "intext", name: "INT / EXT", type: "choice", section: "Script", options: [{ value: "INT", color: 6 }, { value: "EXT", color: 4 }], on: ["shot", "set"] },
  { id: "daynight", name: "Day / Night", type: "choice", section: "Script", options: [{ value: "Day", color: 3 }, { value: "Night", color: 1 }, { value: "Dusk", color: 2 }], on: ["shot", "set"] },
  { id: "size", name: "Shot size", type: "choice", section: "Camera", options: [{ value: "EWS", color: 1 }, { value: "WS", color: 6 }, { value: "MS", color: 4 }, { value: "MCU", color: 3 }, { value: "CU", color: 2 }, { value: "ECU", color: 7 }], on: ["shot"] },
  { id: "angle", name: "Angle", type: "choice", section: "Camera", options: [{ value: "Eye level", color: 0 }, { value: "High", color: 6 }, { value: "Low", color: 2 }, { value: "Top", color: 7 }], on: ["shot"] },
  { id: "move", name: "Movement", type: "multi", section: "Camera", options: [{ value: "Static", color: 0 }, { value: "Pan", color: 6 }, { value: "Tilt", color: 4 }, { value: "Push in", color: 2 }, { value: "Tracking", color: 3 }], on: ["shot"] },
  { id: "support", name: "Support", type: "choice", section: "Camera", options: [{ value: "Tripod", color: 0 }, { value: "Handheld", color: 2 }, { value: "Dolly", color: 6 }, { value: "Gimbal", color: 4 }], on: ["shot"] },
  { id: "lens", name: "Lens", type: "text", section: "Camera", on: ["shot"] },
  { id: "status", name: "Status", type: "choice", section: "This project", options: [{ value: "Idea", color: 0 }, { value: "Planned", color: 6 }, { value: "Approved", color: 4 }], on: ["shot", "photo", "canvas"] },
  { id: "kind", name: "Kind", type: "choice", options: [{ value: "Floor plan", color: 6 }, { value: "Lighting diagram", color: 2 }, { value: "Storyboard", color: 4 }, { value: "Blocking", color: 3 }], on: ["canvas"] },
  { id: "locations", name: "Locations", type: "reference", target: "location", many: true, on: ["set"] },
  { id: "address", name: "Address", type: "text", on: ["location"] },
  { id: "position", name: "Position", type: "position", on: ["location"] },
];

export interface FileRec {
  id: string; type: FileType; name: string;
  /** The folder or collection it sits in; undefined = top level of the project. */
  parent?: string;
  created: string; by: string;
  /** Facts of the file type, read-only. */
  facts?: [string, string][];
  /** Project-defined property values by property id. */
  props: Record<string, string | string[]>;
  /** A shot's content list / a set's or location's content: file ids. The first picture is the thumbnail. */
  content?: string[];
  /** Seed of the generated picture (photos and canvases). */
  pic?: number;
  /** Fixed folders cannot be renamed, moved or binned. */
  fixed?: boolean;
  binned?: boolean;
  /** A collection's colour: one of the eight categorical colours (1 to 8) or a colour of the user's own (hex). Given at random on creation, stored with the collection, the same for everyone. */
  color?: number | string;
  /** A location's place on the fake map, in percent. */
  pos?: [number, number];
  /** An internal file: made inside this file (its parent), hidden from the browser, lives and dies with it. */
  internalOf?: string;
}

const day = (d: number, h = 10) => `2026-11-${String(d).padStart(2, "0")} ${String(h).padStart(2, "0")}:${String((d * 7) % 60).padStart(2, "0")}`;
const photo = (n: number, parent: string | undefined, pic: number, mm: number, d: number): FileRec => ({
  id: `ph${n}`, type: "photo", name: `Photo ${String(n).padStart(4, "0")}`, parent, created: day(d, 9 + (n % 9)), by: "Ada", pic, props: {},
  facts: [["Size", "4000 × 3000"], ["Taken", day(d, 9 + (n % 9))], ["Angle of view", mm === 13 ? "108° × 91°" : mm === 24 ? "74° × 59°" : "24° × 18°"], ["Lens", `${mm} mm equivalent`], ["Device", "Pixel 9 Pro"]],
});

export const FILES: FileRec[] = [
  { id: "f-desktop", type: "folder", name: "Desktop", created: day(2), by: "System", props: {}, fixed: true },
  { id: "f-settings", type: "folder", name: "Settings", created: day(2), by: "System", props: {}, fixed: true },
  { id: "f-scout", type: "folder", name: "Scouting", created: day(3), by: "Ada", props: {} },
  { id: "f-harbour", type: "folder", name: "Harbour", parent: "f-scout", created: day(4), by: "Ada", props: {} },
  { id: "f-flat", type: "folder", name: "Flat Weber", parent: "f-scout", created: day(5), by: "Ada", props: {} },
  { id: "f-boards", type: "folder", name: "Storyboards", created: day(6), by: "Ben", props: {} },

  { id: "c-dusk", type: "collection", name: "Harbour at dusk", parent: "f-harbour", created: day(4, 17), by: "Ada", props: {}, color: 2 },
  { id: "c-rooms", type: "collection", name: "Flat Weber, rooms", parent: "f-flat", created: day(5, 11), by: "Ada", props: {}, color: 6 },

  photo(101, "c-dusk", 11, 24, 4), photo(102, "c-dusk", 12, 24, 4), photo(103, "c-dusk", 13, 13, 4), photo(104, "c-dusk", 14, 120, 4), photo(105, "c-dusk", 15, 24, 4), photo(106, "c-dusk", 16, 13, 4),
  photo(121, "c-rooms", 31, 13, 5), photo(122, "c-rooms", 32, 13, 5), photo(123, "c-rooms", 33, 24, 5), photo(124, "c-rooms", 34, 24, 5), photo(125, "c-rooms", 35, 13, 5),
  photo(131, "f-harbour", 17, 24, 6), photo(132, "f-harbour", 18, 120, 6), photo(141, "f-flat", 36, 24, 7), photo(142, undefined, 41, 24, 8), photo(143, undefined, 42, 13, 8), photo(144, undefined, 43, 24, 9),

  { id: "cv1", type: "canvas", name: "Canvas 01", parent: "f-flat", created: day(7), by: "Ben", pic: 61, props: { kind: "Floor plan", status: "Planned" }, facts: [["Surface", "Blank, 4:3"], ["Layers", "3"]] },
  { id: "cv2", type: "canvas", name: "Canvas 02", parent: "f-harbour", created: day(7, 15), by: "Ada", pic: 12, props: { status: "Approved" }, facts: [["Surface", "Photo 0102"], ["Frames", "3 · picture: 35 mm"], ["Layers", "2"]] },
  { id: "cv3", type: "canvas", name: "Canvas 03", parent: "f-boards", created: day(8), by: "Ben", pic: 62, props: { kind: "Storyboard", status: "Idea" }, facts: [["Surface", "Blank, 16:9"], ["Layers", "1"]] },
  { id: "cv4", type: "canvas", name: "Canvas 04", parent: "f-boards", created: day(8, 13), by: "Ben", pic: 63, props: { kind: "Storyboard" }, facts: [["Surface", "Blank, 16:9"], ["Layers", "2"]] },
  { id: "cv5", type: "canvas", name: "Canvas 05", parent: "f-harbour", created: day(9), by: "Ada", pic: 64, props: { kind: "Lighting diagram", status: "Planned" }, facts: [["Surface", "Blank, 1:1"], ["Layers", "4"]] },

  { id: "set1", type: "set", name: "Joe's kitchen", created: day(3), by: "Ada", props: { intext: "INT", daynight: "Day", locations: ["loc1"] }, content: ["ph123", "cv1"] },
  { id: "set2", type: "set", name: "Stairwell", created: day(3), by: "Ada", props: { intext: "INT", daynight: "Night", locations: ["loc1"] }, content: ["ph125"] },
  { id: "set3", type: "set", name: "Harbour quay", created: day(3), by: "Ada", props: { intext: "EXT", daynight: "Dusk", locations: ["loc2", "loc3"] }, content: ["ph102", "ph103"] },
  { id: "set4", type: "set", name: "Night train compartment", created: day(3), by: "Ada", props: { intext: "INT", daynight: "Night", locations: [] }, content: [] },

  { id: "loc1", type: "location", name: "Altbau Hauptstraße 5", created: day(5), by: "Ada", props: { address: "Hauptstraße 5, 20095 Hamburg" }, content: ["ph121", "ph122", "ph123", "cv1"], pos: [38, 44] },
  { id: "loc2", type: "location", name: "Fischmarkt quay", created: day(4), by: "Ada", props: { address: "Große Elbstraße 9, 22767 Hamburg" }, content: ["ph101", "ph102", "ph103", "cv5"], pos: [22, 68] },
  { id: "loc3", type: "location", name: "Museumshafen Oevelgönne", created: day(6), by: "Ada", props: { address: "Neumühlen, 22763 Hamburg" }, content: ["ph131", "ph132"], pos: [9, 61] },
  { id: "loc4", type: "location", name: "Depot Museumsbahn", created: day(9), by: "Ben", props: { address: "" }, content: [] },

  { id: "s1", type: "shot", name: "Shot 01", created: day(6), by: "Ada", props: { scene: "12", no: "1", set: "set3", intext: "EXT", daynight: "Dusk", size: "EWS", angle: "Eye level", move: ["Static"], support: "Tripod", lens: "24 mm", status: "Approved" }, content: ["cv2", "ph103"] },
  { id: "s2", type: "shot", name: "Shot 02", created: day(6), by: "Ada", props: { scene: "12", no: "2", set: "set3", intext: "EXT", daynight: "Dusk", size: "MS", angle: "Low", move: ["Push in"], support: "Dolly", lens: "50 mm", status: "Planned" }, content: ["ph104"] },
  { id: "s3", type: "shot", name: "Shot 03", created: day(6), by: "Ada", props: { scene: "12", no: "3", set: "set3", intext: "EXT", daynight: "Dusk", size: "CU", angle: "Eye level", move: ["Static"], support: "Tripod", lens: "85 mm", status: "Planned" }, content: ["ph132"] },
  { id: "s4", type: "shot", name: "Shot 04", created: day(7), by: "Ada", props: { scene: "14", no: "1", set: "set1", intext: "INT", daynight: "Day", size: "WS", angle: "High", move: ["Pan"], support: "Tripod", lens: "18 mm", status: "Approved" }, content: ["ph121", "cv1"] },
  { id: "s5", type: "shot", name: "Shot 05", created: day(7), by: "Ada", props: { scene: "14", no: "2", set: "set1", intext: "INT", daynight: "Day", size: "MCU", angle: "Eye level", move: ["Static"], support: "Handheld", lens: "35 mm", status: "Idea" }, content: ["ph123"] },
  { id: "s6", type: "shot", name: "Shot 06", created: day(7), by: "Ben", props: { scene: "14", no: "3", set: "set1", intext: "INT", daynight: "Day", size: "ECU", move: ["Static"], status: "Idea" }, content: ["cv3"] },
  { id: "s7", type: "shot", name: "Shot 07", created: day(8), by: "Ben", props: { scene: "15", no: "1", set: "set2", intext: "INT", daynight: "Night", size: "WS", angle: "Top", move: ["Tilt"], support: "Gimbal", lens: "24 mm", status: "Planned" }, content: ["ph125"] },
  { id: "s8", type: "shot", name: "Shot 08", created: day(8), by: "Ben", props: { scene: "15", no: "2", set: "set2", intext: "INT", daynight: "Night", size: "MS", status: "Idea" }, content: ["cv4"] },
  { id: "s9", type: "shot", name: "Shot 09", created: day(9), by: "Ada", props: { scene: "21", no: "1", set: "set4", intext: "INT", daynight: "Night" }, content: [] },
  { id: "s10", type: "shot", name: "Shot 10", created: day(9), by: "Ada", props: { scene: "21", no: "2" }, content: [] },

  { id: "t1", type: "timeline", name: "Scene 12, first pass", created: day(9), by: "Ada", props: {}, facts: [["Clips", "7"], ["Length", "0:38"]] },
  { id: "t2", type: "timeline", name: "Scene 14", created: day(9, 16), by: "Ben", props: {}, facts: [["Clips", "5"], ["Length", "0:21"]] },
  { id: "q1", type: "filter", name: "Night interiors", created: day(8), by: "Ada", props: {}, facts: [["Query", "Shots · INT · Night"]] },
  { id: "q2", type: "filter", name: "Shots without a picture", created: day(8), by: "Ada", props: {}, facts: [["Query", "Shots · no content"]] },
  { id: "p1", type: "preset", name: "Pocket 6K · Sigma 18–35", created: day(3), by: "Ada", props: {}, facts: [["Format", "23.10 × 12.99 mm"], ["Lenses", "Zoom 18–35 mm"], ["Delivery", "2.39:1"]] },
  { id: "p2", type: "preset", name: "Full frame primes", created: day(3), by: "Ada", props: {}, facts: [["Format", "36 × 24 mm"], ["Lenses", "24, 35, 50, 85 mm"]] },

  { id: "b1", type: "photo", name: "Photo 0099", created: day(3), by: "Ada", pic: 44, props: {}, binned: true, facts: [["Size", "4000 × 3000"]] },
  { id: "b2", type: "canvas", name: "Canvas 00", created: day(3), by: "Ben", pic: 65, props: {}, binned: true },
];

// A few photos carry a status, so a board of photos has something in its columns.
for (const [id, status] of [["ph101", "Approved"], ["ph103", "Planned"], ["ph122", "Planned"], ["ph124", "Idea"], ["ph142", "Idea"]]) FILES.find((f) => f.id === id)!.props.status = status;

/** Saved filters as queries the prototype can run. */
export const QUERIES: Record<string, { types: FileType[]; where: Record<string, string>; empty?: boolean }> = {
  q1: { types: ["shot"], where: { intext: "INT", daynight: "Night" } },
  q2: { types: ["shot"], where: {}, empty: true },
};
