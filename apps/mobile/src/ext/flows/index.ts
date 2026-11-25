/**
 * The Flows extension on the phone (docs/features/flows.md): its app and its channel on the phone link (run.ts).
 * Imported only by src/extensions.ts.
 */
import { registerApp } from "../../apps/registry";
import "./run";
import { FlowsApp } from "./ui/FlowsApp";

registerApp({ id: "flows", label: "Flows", icon: "timeline", needsProject: true, extension: "flows", Screen: FlowsApp });
