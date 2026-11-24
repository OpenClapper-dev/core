// Registration points of the Devices app (docs/rewrite/08-extensions.md, "Devices: one word, one registry"). The
// core draws phones and tablets; an extension that brings device kinds registers how its devices show (a card,
// table cells, toolbar parts) and which of its apps a phone can show as a tab. Nothing here imports an extension.
import type { ComponentChildren, ComponentType } from "preact";
import type { IconName } from "@openclapper/design";
import type { FileRec } from "./api";

/** What a table row shows of a device. */
export interface DeviceCells { type: ComponentChildren; model: string; link: ComponentChildren; battery: ComponentChildren; power: ComponentChildren }

export interface DeviceView<Ctx = unknown> {
  /** The extension that brings these kinds; its devices show only while the project has it on. */
  extension: string;
  kinds: readonly string[];
  /** Called once per render of the Devices app, always (a hook): the live state the parts below read. */
  useContext(files: FileRec[]): Ctx;
  Card: ComponentType<{ d: FileRec; all: FileRec[]; ctx: Ctx }>;
  cells(d: FileRec, all: FileRec[], ctx: Ctx): DeviceCells;
  /** Parts of the toolbar (the proxy pill, Add a device). */
  Toolbar?: ComponentType<{ files: FileRec[]; ctx: Ctx }>;
}

const views: DeviceView[] = [];
export function registerDeviceView<Ctx>(v: DeviceView<Ctx>) { views.push(v as DeviceView); }
export const deviceViews = (): readonly DeviceView[] => views;

/** Apps a phone or tablet can show as tabs, beyond the core's (an extension's touch forms). */
const tabs: { id: string; label: string; icon: IconName; extension: string }[] = [];
export function registerPhoneTab(t: (typeof tabs)[number]) { tabs.push(t); }
export const phoneTabs = () => tabs;
