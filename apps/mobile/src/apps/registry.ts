import type { ComponentType } from "react";
import type { IconName } from "../ui";

/**
 * The apps with a touch form (docs/rewrite/09-shells.md): what can be a tab on a phone or tablet.
 * The ids are the catalogue's, the same as the Studio's; a device's tabs naming an app this build
 * does not have (Shots before step B6, an extension's) are kept in the device file and not shown.
 */
export interface PhoneApp {
  id: string;
  label: string;
  icon: IconName;
  /** Works inside a project: asks for one when none is chosen. */
  needsProject: boolean;
  /** `active`: this tab is the one in front. Apps stay mounted while another tab is in front. */
  Screen: ComponentType<{ active: boolean }>;
}

const apps = new Map<string, PhoneApp>();
const order: string[] = [];

export function registerApp(app: PhoneApp) {
  if (!apps.has(app.id)) order.push(app.id);
  apps.set(app.id, app);
}
export const appOf = (id: string) => apps.get(id) ?? null;
/** Every app of this build, in catalogue order; Setup is not among the choices. */
export const catalogue = (): PhoneApp[] => order.map((id) => apps.get(id)!).filter((a) => a.id !== "setup");
