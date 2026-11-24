// The Hardware extension in the Studio (docs/features/hardware.md): its devices in the Devices app, and its phone app
// as a tab a phone can show. Imported only by src/extensions.ts.
import { HARDWARE_TYPES } from "@openclapper/ext-hardware";
import { registerDeviceView, registerPhoneTab } from "../../devices";
import { Card, Toolbar, cells, useContext } from "./view";

registerDeviceView({ extension: "hardware", kinds: HARDWARE_TYPES, useContext, Card, cells, Toolbar });
registerPhoneTab({ id: "hardware", label: "Hardware", icon: "light-fixture", extension: "hardware" });
