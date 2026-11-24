// The canvas editor alone, for the phone and tablet app's web view (docs/features/canvas.md, "The tablet"):
// `#/embed/canvas/<id>?theme=light|dark`. No desktop, no taskbar: the app around it has its own header.
// The session arrives as the cookie the web route set (GET /api/web).
import { useEffect, useState } from "preact/hooks";
import { EmptyState, Spinner } from "@openclapper/design";
import * as api from "./api";
import { Editing } from "./apps/CanvasApp";
import { useRoot } from "./files";
import { usePeople } from "./people";
import { setTheme } from "./theme";
import { boot, useUser } from "./user";

export const embedOf = (hash: string): { id: string; theme: string | null } | null => {
  const m = /^#\/embed\/canvas\/([0-9a-f-]{36})(?:\?(.*))?$/i.exec(hash);
  return m ? { id: m[1], theme: new URLSearchParams(m[2] ?? "").get("theme") } : null;
};

export function EmbedCanvas({ id, theme }: { id: string; theme: string | null }) {
  const user = useUser();
  const [file, setFile] = useState<api.FileRec | null | "gone">(null);
  const [project, setProject] = useState<api.Project | undefined>();
  useEffect(() => { if (theme === "light" || theme === "dark") setTheme(theme); void boot(); }, []);
  useEffect(() => {
    if (user.status !== "signed-in") return;
    void api.get<{ file: api.FileRec }>(`/api/files/${id}`).then((r) => setFile(r.file), () => setFile("gone"));
  }, [user.status]);
  const projectId = file && file !== "gone" ? file.project_id : null;
  useEffect(() => { if (projectId) void api.fetchProjects().then((ps) => setProject(ps.find((p) => p.id === projectId)), () => {}); }, [projectId]);
  if (user.status === "checking" || (user.status === "signed-in" && file === null)) return <div className="st-center" style={{ height: "100vh" }}><Spinner /></div>;
  if (user.status !== "signed-in") return <EmptyState icon="lock" title="Not signed in">Open the canvas from the app again.</EmptyState>;
  if (file === "gone" || !file || file.type !== "canvas" || !projectId) return <EmptyState icon="brush" title="This canvas is gone">It was deleted, or it is not yours to open.</EmptyState>;
  return <Embedded file={file} projectId={projectId} workspaceId={project?.workspace_id} live={project?.canvas_live} me={user.me.user} />;
}

function Embedded({ file, projectId, workspaceId, live, me }: { file: api.FileRec; projectId: string; workspaceId: string | undefined; live: api.CanvasLive | undefined; me: api.Me["user"] }) {
  const { files } = useRoot({ project: projectId });
  const people = usePeople(workspaceId);
  const current = files?.find((f) => f.id === file.id) ?? null;
  if (!files || !current) return <div className="st-center" style={{ height: "100vh" }}><Spinner /></div>;
  return (
    <div className="cv-standalone">
      <Editing live={live} file={current} files={files} projectId={projectId} active hosted me={{ id: me.id, name: me.name ?? me.email }} nameOf={(u) => (u === me.id ? "You" : people.get(u) ?? "Someone")} />
    </div>
  );
}
