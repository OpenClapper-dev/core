import { BUILTIN_LAYOUTS, isBuiltinLayout, layoutError, type LayoutBody } from "@openclapper/model";
import { randomUUID } from "expo-crypto";
import { canCall, getFile, isRejection, listFiles, putFile } from "../api";
import { device, setDeviceLayout } from "../device";
import { previewLayout } from "../link";
import { log } from "../log";
import { persisted } from "../store";
import { onSync } from "../sync";
import { toast } from "../ui";

/**
 * The camera layouts on the phone (docs/features/camera-layouts.md): the built-in Camera and Viewfinder and the
 * account's own (files of its home, kept on the phone so the camera opens with them offline). The one in use is
 * the device's choice (changed here or in the Studio); a layout the Studio previews takes its place meanwhile.
 */
export interface PhoneLayout { id: string; name: string; body: LayoutBody; builtin: boolean }
export const ownLayouts = persisted<{ id: string; name: string; body: LayoutBody }[]>("layouts.v2", [], Array.isArray);

export async function loadLayouts(): Promise<void> {
  if (!canCall()) return;
  try {
    const files = await listFiles({ home: true }, { type: "layout", body: true });
    ownLayouts.set(files.filter((f) => f.body && !layoutError(f.body)).map((f) => ({ id: f.id, name: f.name, body: f.body as unknown as LayoutBody })));
  } catch (e) { log("warn", "layouts load failed", e); }
}
onSync(loadLayouts);

/** Every layout the phone can use: the built-in ones first. */
export function allLayouts(): PhoneLayout[] {
  return [
    ...(["camera", "viewfinder"] as const).map((id) => ({ id, name: BUILTIN_LAYOUTS[id].name, body: BUILTIN_LAYOUTS[id].body, builtin: true })),
    ...ownLayouts.get().map((l) => ({ ...l, builtin: false })),
  ];
}

/** The layout in use: the Studio's preview, else the device's choice, else the Viewfinder (a choice that is gone falls back). */
export function useLayout(): { layout: PhoneLayout; preview: boolean; orientation: "portrait" | "landscape" | null } {
  const prev = previewLayout.use();
  const own = ownLayouts.use();
  const dev = device.use();
  if (prev && !layoutError(prev.layout as Record<string, unknown>)) return { layout: { id: "preview", name: "Studio preview", body: prev.layout as LayoutBody, builtin: true }, preview: true, orientation: prev.orientation };
  const choice = (dev.layout ?? dev.file?.body?.layout ?? "viewfinder") as string;
  const mine = own.find((l) => l.id === choice);
  const layout: PhoneLayout = mine ? { ...mine, builtin: false } : isBuiltinLayout(choice) ? { id: choice, name: BUILTIN_LAYOUTS[choice].name, body: BUILTIN_LAYOUTS[choice].body, builtin: true } : { id: "viewfinder", name: "Viewfinder", body: BUILTIN_LAYOUTS.viewfinder.body, builtin: true };
  return { layout, preview: false, orientation: null };
}

export const chooseLayout = (id: string) => setDeviceLayout(id);

// ---------- Changing a layout's look and options on the phone ----------
// The bars are arranged in the Studio; the look and the options can be changed here too (decided for B8). An edit
// shows at once and waits on the phone; it is sent as a patch on the server's layout as it is then, so what the
// Studio changed meanwhile stays. A layout that is gone, or an edit the server refuses, is dropped with a message.
type Patch = { look?: Partial<LayoutBody["look"]>; options?: Partial<LayoutBody["options"]> };
const edits = persisted<Record<string, Patch>>("layoutEdits.v1", {});

export function editLayout(id: string, patch: Patch) {
  edits.set((e) => ({ ...e, [id]: { look: { ...e[id]?.look, ...patch.look }, options: { ...e[id]?.options, ...patch.options } } }));
  ownLayouts.set((all) => all.map((l) => (l.id === id ? { ...l, body: { ...l.body, look: { ...l.body.look, ...patch.look }, options: { ...l.body.options, ...patch.options } } } : l)));
  void flushLayoutEdits();
}

let flushing: Promise<void> | null = null;
export function flushLayoutEdits(): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    if (!canCall()) return;
    for (const [id, p] of Object.entries(edits.get())) {
      try {
        const f = await getFile(id);
        const b = f.body as unknown as LayoutBody;
        const body = { ...b, look: { ...b.look, ...p.look }, options: { ...b.options, ...p.options } };
        await putFile(id, { type: "layout", home: true, body: body as unknown as Record<string, unknown> });
      } catch (e) {
        if (!isRejection(e)) return;
        toast(`A change of the layout could not be saved: ${(e as Error).message}`, "danger");
      }
      edits.set((all) => { const { [id]: _drop, ...rest } = all; void _drop; return rest; });
    }
    await loadLayouts();
  })().finally(() => { flushing = null; });
  return flushing;
}
onSync(flushLayoutEdits);

/** A copy of a layout to change (a built-in one cannot be): made on the server, used on this device at once. */
export async function copyLayoutToChange(from: PhoneLayout): Promise<void> {
  if (!canCall()) { toast("A copy needs a connection", "danger"); return; }
  try {
    const id = randomUUID();
    await putFile(id, { type: "layout", home: true, name: `${from.name}, copy`.slice(0, 120), body: from.body as unknown as Record<string, unknown> });
    await loadLayouts();
    chooseLayout(id);
  } catch (e) { toast(`No copy: ${(e as Error).message}`, "danger"); }
}
