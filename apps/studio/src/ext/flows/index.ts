// The Flows extension in the Studio (docs/features/flows.md): its app, how its files look and its phone tab (the
// device has its own native editor). Imported only by src/extensions.ts.
import { registerApp } from "../../apps/registry";
import { registerPhoneTab } from "../../devices";
import { registerFileLook } from "../../fileKinds";
import { FlowsApp } from "./FlowsApp";

registerApp({
  id: "flows", name: "Flows", glyph: "bulb", color: 14, tier: "extension", extension: "flows", singleton: true, opens: ["flow"],
  defaultSize: { w: 1320, h: 820 }, minSize: { w: 760, h: 480 }, component: FlowsApp,
  fromRoute: (rest) => ({ resource: rest ? { type: "flow", id: rest } : null }), about: "Timed programmes for lights and cameras",
});
registerFileLook("flow", { glyph: "bulb", color: 14 });
registerPhoneTab({ id: "flows", label: "Flows", icon: "timeline", extension: "flows" });
