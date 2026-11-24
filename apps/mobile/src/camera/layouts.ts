import { BUILTIN_LAYOUTS, isBuiltinLayout, layoutError, type LayoutBody } from "@openclapper/model";
import { canCall, listFiles } from "../api";
import { device, setDeviceLayout } from "../device";
import { previewLayout } from "../link";
import { log } from "../log";
import { persisted } from "../store";
import { onSync } from "../sync";

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
