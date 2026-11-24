/**
 * The Hardware extension (docs/rewrite/08-extensions.md): lights, batteries, cameras and video transmitters
 * in the account's device registry, a catalogue of the supported models, pairing, and the phone as proxy.
 * What the Worker, the Studio and the phone share lives here; each registers it from its own `extensions.ts`.
 */
import { registerCameraControl, registerExtension, type ExtensionDef } from "@openclapper/model";

export const HARDWARE: ExtensionDef = {
  id: "hardware",
  name: "Hardware",
  about: "Lights, batteries, cameras and video transmitters, controlled through your phone",
  needs: [],
  brings: ["Device types: light, battery, camera, video transmitter", "Apps: Devices across types, Hardware on the phone", "Camera control: Hardware"],
};

registerExtension(HARDWARE);
// A camera layout can place it: on the phone it opens the device cards over the camera (owner's decision 2026-11-24).
registerCameraControl("hardware", { label: "Hardware", icon: "light-fixture", short: "Hardware", kind: "button", extension: "hardware" });

export * from "./lighting.ts";
export * from "./lightProxy.ts";
export * from "./cameraControl.ts";
export * from "./lightSequence.ts";
export * from "./sequencePlayer.ts";
export * from "./catalogue.ts";
export * from "./device.ts";
export * from "./protocol.ts";
export * from "./effects.ts";
