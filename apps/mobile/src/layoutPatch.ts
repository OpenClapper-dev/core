import { layoutLook, layoutOptions, type ViewfinderLayout, type VfLook, type VfOptions } from "@fielder/vocab";

/**
 * What the phone changes on a layout (issue #198): look and options only, the bars are the Studio's.
 * HUD chips count one by one, so a chip toggled on the phone leaves the others as the Studio set them.
 */
export interface LayoutPatch {
  look?: Partial<Omit<VfLook, "hud">> & { hud?: Partial<VfLook["hud"]> };
  options?: Partial<VfOptions>;
}

/** The layout with the phone's change on top; everything the patch does not name stays as it is in `l`. */
export function applyPatch(l: ViewfinderLayout, p: LayoutPatch): ViewfinderLayout {
  const look = layoutLook(l), opt = layoutOptions(l);
  return { ...l, look: { ...look, ...p.look, hud: { ...look.hud, ...p.look?.hud } }, options: { ...opt, ...p.options } };
}

/** Two unsent edits to one layout as one: the later wins field by field. */
export function mergePatch(a: LayoutPatch, b: LayoutPatch): LayoutPatch {
  return {
    look: { ...a.look, ...b.look, hud: { ...a.look?.hud, ...b.look?.hud } },
    options: { ...a.options, ...b.options },
  };
}
