/**
 * The Hardware extension on the phone (docs/features/hardware.md): its app, its sync task and its channel on the
 * phone link. Imported only by src/extensions.ts.
 */
import { registerApp } from "../../apps/registry";
import { log } from "../../log";
import { onSync } from "../../sync";
import { backupAll } from "./keyBackup";
import { syncDevices } from "./library";
import { syncMeshNetworks } from "./meshNetworks";
import "./proxy";
import { HardwareApp } from "./ui/HardwareApp";

registerApp({ id: "hardware", label: "Hardware", icon: "light-fixture", needsProject: false, extension: "hardware", Screen: HardwareApp });

// Beside the uploads, after them (08-extensions.md): networks first (a light names its network), then the
// devices, then the sealed keys of anything paired offline. It never delays or fails a photo upload.
onSync(async () => {
  try {
    await syncMeshNetworks();
    await syncDevices();
    await backupAll();
  } catch (e) { log("info", "hardware sync skipped", { error: e }); }
});
