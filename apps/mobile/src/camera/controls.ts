import type { ComponentType } from "react";

/**
 * Camera controls an extension brings (docs/rewrite/08-extensions.md, "Camera controls"): the model's catalogue
 * names them (registerCameraControl); here the extension says what a tap does, as a sheet over the camera. A control
 * without a view, or whose extension the project has off, is left out of the camera.
 */
export interface CameraControlView { Sheet: ComponentType<{ onClose: () => void }> }
const views = new Map<string, CameraControlView>();
export const registerCameraControlView = (id: string, v: CameraControlView) => { views.set(id, v); };
export const cameraControlView = (id: string) => views.get(id);
