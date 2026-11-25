// The flow editor alone, for the phone and tablet app's web view (docs/features/flows.md, "On the device"):
// `#/embed/flow/<id>`. The same editor as the Studio's, without the list of flows.
import { useEffect } from "preact/hooks";
import { Spinner } from "@openclapper/design";
import type { FileRec } from "../../api";
import { useRoot } from "../../files";
import { loadProjects } from "../../projects";
import { FlowEditor } from "./FlowsApp";

export function EmbedFlow({ file, projectId }: { file: FileRec; projectId: string }) {
  const { files } = useRoot({ project: projectId });
  // The project's live setting and its people's names, as in the Studio.
  useEffect(() => { void loadProjects(); }, []);
  const current = files?.find((f) => f.id === file.id) ?? null;
  if (!files || !current) return <div className="st-center" style={{ height: "100vh" }}><Spinner /></div>;
  return <FlowEditor f={current} projectId={projectId} active hosted />;
}
