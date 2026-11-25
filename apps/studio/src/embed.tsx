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

export const embedOf = (hash: string): { kind: string; id: string; theme: string | null } | null => {
  const m = /^#\/embed\/([a-z][a-z0-9-]{1,39})\/([0-9a-f-]{36})(?:\?(.*))?$/i.exec(hash);
  return m ? { kind: m[1], id: m[2], theme: new URLSearchParams(m[3] ?? "").get("theme") } : null;
};

/** An editor an extension offers to the phone's web view (`#/embed/<type>/<id>`): it gets the file and its project. */
export type EmbedView = (p: { file: api.FileRec; projectId: string }) => preact.JSX.Element;
const embeds = new Map<string, EmbedView>();
export function registerEmbed(type: string, view: EmbedView) { embeds.set(type, view); }

/** A file of a registered type, alone in the page; the session as for the canvas. */
export function EmbedFile({ kind, id, theme }: { kind: string; id: string; theme: string | null }) {
  const user = useUser();
  const [file, setFile] = useState<api.FileRec | null | "gone">(null);
  useEffect(() => { if (theme === "light" || theme === "dark") setTheme(theme); void boot(); }, []);
  useEffect(() => { if (user.status === "signed-in") void api.get<{ file: api.FileRec }>(`/api/files/${id}`).then((r) => setFile(r.file), () => setFile("gone")); }, [user.status]);
  if (user.status === "checking" || (user.status === "signed-in" && file === null)) return <div className="st-center" style={{ height: "100vh" }}><Spinner /></div>;
  if (user.status !== "signed-in") return <EmptyState icon="lock" title="Not signed in">Open it from the app again.</EmptyState>;
  if (!embeds.has(kind) || file === "gone" || !file || file.type !== kind || !file.project_id) return <EmptyState icon="file" title="This file is gone">It was deleted, or it is not yours to open.</EmptyState>;
  return embeds.get(kind)!({ file, projectId: file.project_id });
}

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
