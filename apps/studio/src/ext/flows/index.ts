// The Flows extension in the Studio (docs/features/flows.md): its app, how its files look, its phone tab, and its
// editor for the phone and tablet app's web view. Imported only by src/extensions.ts.
import { registerApp } from "../../apps/registry";
import { registerPhoneTab } from "../../devices";
import { registerEmbed } from "../../embed";
import { registerFileLook } from "../../fileKinds";
import { EmbedFlow } from "./embed";
import { FlowsApp } from "./FlowsApp";

registerApp({
  id: "flows", name: "Flows", glyph: "timeline", color: 3, tier: "extension", extension: "flows", singleton: true, opens: ["flow"],
  defaultSize: { w: 1320, h: 820 }, minSize: { w: 760, h: 480 }, component: FlowsApp,
  fromRoute: (rest) => ({ resource: rest ? { type: "flow", id: rest } : null }), about: "Timed programmes for lights and cameras",
});
registerFileLook("flow", { glyph: "timeline", color: 3 });
registerPhoneTab({ id: "flows", label: "Flows", icon: "timeline", extension: "flows" });
registerEmbed("flow", EmbedFlow);
