import { useEffect, useState } from "preact/hooks";
import { AppIcon, Badge, Button, EmptyState, FormField, PropertyList, PropertyRow, PropertySection, Segmented, Select, SettingsGroup, TextArea, TextInput } from "@openclapper/design";
import { ApiError, projectPictureUrl, type Project } from "../api";
import { confirm, prompt, toast, toastError } from "../hosts";
import { switchProject } from "../project";
import { removeProject, saveProject, setCanvasLive, setDescription, setPicture, useProjects } from "../projects";
import { useUser } from "../user";
import { useCatalogue } from "../props";
import { NamingPage } from "./project/Naming";
import { PropertiesPage } from "./project/Properties";
import { ExtensionsPage } from "./project/Extensions";
import "../catalogue.css";

/** The project's pages in Settings (#426: the Project app folded into Settings). */
export const PROJECT_TABS = ["general", "properties", "naming", "extensions", "customizations", "projects"] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
/** A name the server refused because it is taken reads better than "409". */
const nameTaken = (e: unknown) => e instanceof ApiError && e.status === 409;

/**
 * The project's pages of Settings (docs/rewrite/09-shells.md): this project's own settings, and
 * switching and managing projects; the property catalogue and the naming patterns
 * (docs/features/properties.md); the extensions switched on for it (docs/rewrite/08-extensions.md).
 */
export function ProjectPage({ tab, winId, projectId }: { tab: ProjectTab; winId: string; projectId: string }) {
  const { list } = useProjects();
  const user = useUser();
  const projects = list ?? [];
  const current = projects.find((p) => p.id === projectId);
  const workspaces = user.status === "signed-in" ? user.me.workspaces : [];
  const wsName = (id: string) => workspaces.find((w) => w.id === id)?.name ?? "—";
  const catalogue = useCatalogue(projectId);

  const [name, setName] = useState(current?.name ?? "");
  const [wrong, setWrong] = useState<string | null>(null);
  useEffect(() => { setName(current?.name ?? ""); setWrong(null); }, [current?.id, current?.name]);
  const rename = async (id: string, to: string) => {
    try { await saveProject(id, to); toast("Project renamed"); return true; }
    catch (e) { if (nameTaken(e)) return false; toastError(e); return true; }
  };
  const saveName = async () => {
    const to = name.trim();
    if (!current || !to || to === current.name) return;
    setWrong((await rename(current.id, to)) ? null : "Another project of this workspace has this name");
  };
  const askRename = async (id: string, was: string) => {
    const to = await prompt({ title: "Rename project", label: "Name", value: was, confirmLabel: "Rename" });
    if (to && to !== was && !(await rename(id, to))) toast("Another project of this workspace has this name", { tone: "warning" });
  };
  const remove = async (id: string) => {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    if (p.file_count > 0) { toast(`“${p.name}” still has ${p.file_count} file${p.file_count === 1 ? "" : "s"}. Delete them first.`, { tone: "warning" }); return; }
    if (!(await confirm({ title: `Delete “${p.name}”?`, message: "The project and what is in its recycle bin are deleted for good.", confirmLabel: "Delete project", danger: true }))) return;
    try { await removeProject(id); toast("Project deleted"); } catch (e) { toastError(e); }
  };

  const editable = workspaces.filter((w) => w.role !== "viewer");
  const [newWs, setNewWs] = useState("");
  const create = async () => {
    const n = await prompt({ title: "New project", label: "Name", confirmLabel: "Create" });
    if (!n) return;
    try {
      const p = await saveProject(crypto.randomUUID(), n, newWs || undefined);
      if (await switchProject(p.id)) toast(`Now working on ${p.name}`);
    } catch (e) { if (nameTaken(e)) toast("A project with this name exists in that workspace", { tone: "warning" }); else toastError(e); }
  };
  const open = async (id: string) => { const p = projects.find((x) => x.id === id); if (id !== projectId && (await switchProject(id))) toast(`Now working on ${p?.name ?? "the project"}`); };

  return (
    <>
      {tab === "properties" && <PropertiesPage projectId={projectId} files={catalogue.files} defs={catalogue.defs} />}
      {tab === "naming" && <NamingPage projectId={projectId} files={catalogue.files} patterns={catalogue.patterns} />}
      {tab === "extensions" && current && <ExtensionsPage project={current} />}
      {/* Customizations (#426): how this project behaves for everyone in it; user policies join here later. */}
      {tab === "customizations" && current && (
        <>
          <SettingsGroup title="Canvases while someone edits them">
            <Segmented label="Live updates" value={current.canvas_live ?? "realtime"} onChange={(v) => void setCanvasLive(current, v as "realtime" | "gradual").catch(toastError)}
              options={[{ value: "realtime", label: "Realtime" }, { value: "gradual", label: "Every 5 seconds" }]} />
            <p className="st-note">{(current.canvas_live ?? "realtime") === "realtime"
              ? "Everyone watching a canvas sees each change and each stroke as it is drawn, and sees at once when the person editing lets it go. It runs on a Durable Object per open canvas, which counts against the Cloudflare plan."
              : "Everyone watching a canvas sees each save as soon as it is made, and at once when it is free to edit; the changes and strokes in between are not streamed. Who edits is always live."}</p>
          </SettingsGroup>
        </>
      )}
      {tab === "general" && current && (
        <>
          <SettingsGroup title="Name">
            <FormField label="Project name" htmlFor={`pn-${winId}`} error={wrong ?? undefined} hint="Unique within its workspace.">
              <span className="st-inline">
                <TextInput id={`pn-${winId}`} value={name} invalid={!!wrong} maxLength={80} style={{ flex: 1 }} onInput={(e) => { setName(e.currentTarget.value); setWrong(null); }} onKeyDown={(e) => { if (e.key === "Enter") void saveName(); }} />
                <Button variant="primary" disabled={!name.trim() || name.trim() === current.name} onClick={() => void saveName()}>Rename</Button>
              </span>
            </FormField>
          </SettingsGroup>
          <SettingsGroup title="Picture and description">
            <ProjectLook p={current} />
          </SettingsGroup>
          <SettingsGroup title="About this project">
            <PropertyList>
              <PropertySection title="Facts" icon="info">
                <PropertyRow label="Workspace" value={wsName(current.workspace_id)} />
                <PropertyRow label="Files" value={String(current.file_count)} numeric />
                <PropertyRow label="Created" value={day(current.created_at)} />
              </PropertySection>
              <PropertySection title="Fixed folders" icon="lock">
                <PropertyRow label="Desktop" value="What is in it shows as icons on the desktop" />
                <PropertyRow label="Settings" value="One file per settings tab: General, Properties, Naming patterns, Extensions, Customizations" />
              </PropertySection>
            </PropertyList>
          </SettingsGroup>
          <SettingsGroup title="Delete">
            <p className="st-note">A project can be deleted once it holds no files. What is in its recycle bin goes with it.</p>
            <span><Button variant="danger" icon="trash" onClick={() => void remove(current.id)}>Delete this project…</Button></span>
          </SettingsGroup>
        </>
      )}
      {tab === "projects" && (
        <>
          <span className="st-inline">
            {editable.length > 1 && <Select size="sm" value={newWs || editable.find((w) => w.personal)?.id || editable[0].id} onChange={setNewWs} options={editable.map((w) => ({ value: w.id, label: w.name }))} aria-label="Workspace of the new project" />}
            <Button variant="primary" icon="plus" disabled={editable.length === 0} onClick={() => void create()}>New project</Button>
          </span>
          {projects.length === 0 ? <EmptyState icon="slate" title="No project yet" /> : workspaces.filter((w) => projects.some((p) => p.workspace_id === w.id)).map((w) => (
            <section key={w.id} className="st-pgroup">
              <h3 className="st-pgroup__head">{w.name}{w.personal && <Badge>Personal</Badge>}<span className="st-note">{projects.filter((p) => p.workspace_id === w.id).length} project{projects.filter((p) => p.workspace_id === w.id).length === 1 ? "" : "s"}</span></h3>
              <div className="st-pcards">
                {projects.filter((p) => p.workspace_id === w.id).map((p) => (
                  <ProjectCard key={p.id} p={p} open={p.id === projectId} onOpen={() => void open(p.id)} onRename={() => void askRename(p.id, p.name)} onDelete={() => void remove(p.id)} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  );
}

/** A project as a card (#426): its picture, name, description and facts; open, rename, delete. Room for more facts later. */
function ProjectCard({ p, open, onOpen, onRename, onDelete }: { p: Project; open: boolean; onOpen: () => void; onRename: () => void; onDelete: () => void }) {
  const pic = projectPictureUrl(p);
  return (
    <article className={`st-pcard${open ? " is-open" : ""}`} onDblClick={open ? undefined : onOpen}>
      <div className="st-pcard__pic">{pic ? <img src={pic} alt="" loading="lazy" /> : <AppIcon glyph="slate" color={2} size={40} />}</div>
      <div className="st-pcard__body">
        <span className="st-inline"><strong className="st-pcard__name">{p.name}</strong>{open && <Badge tone="accent">Open</Badge>}</span>
        {p.description ? <p className="st-pcard__desc">{p.description}</p> : <p className="st-note">No description</p>}
        <span className="st-note">{p.file_count} file{p.file_count === 1 ? "" : "s"} · created {day(p.created_at)}</span>
      </div>
      <div className="st-pcard__act">
        {!open && <Button size="sm" onClick={onOpen}>Open</Button>}
        <Button size="sm" variant="quiet" icon="edit" label={`Rename ${p.name}`} onClick={onRename} />
        <Button size="sm" variant="quiet" icon="trash" label={`Delete ${p.name}`} onClick={onDelete} />
      </div>
    </article>
  );
}

/** The project's picture (uploaded from the computer, scaled to fit 2000 × 2000) and its description, saved on leaving the field. */
function ProjectLook({ p }: { p: Project }) {
  const [text, setText] = useState(p.description);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(p.description); }, [p.id, p.description]);
  const pic = projectPictureUrl(p);
  const choose = (e: Event) => {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = "";
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { toast("That image is too large to use (at most 40 MB before it is scaled)", { tone: "warning" }); return; }
    setBusy(true);
    void setPicture(p, file).then(() => toast("Picture set"), toastError).finally(() => setBusy(false));
  };
  return (
    <div className="st-plook">
      <div className="st-pcard__pic st-plook__pic">{pic ? <img src={pic} alt="" /> : <AppIcon glyph="slate" color={2} size={48} />}</div>
      <div className="st-plook__side">
        <span className="st-inline">
          <label className="oc-btn oc-btn--secondary oc-btn--sm st-plook__upload">{busy ? "Uploading…" : pic ? "Replace picture…" : "Upload a picture…"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={choose} /></label>
          {pic && <Button size="sm" variant="quiet" icon="trash" disabled={busy} onClick={() => { setBusy(true); void setPicture(p, null).catch(toastError).finally(() => setBusy(false)); }}>Remove</Button>}
        </span>
        <span className="st-note">JPEG, PNG or WebP; a larger one is scaled to fit 2000 × 2000.</span>
        <FormField label="Description" htmlFor={`pd-${p.id}`}>
          <TextArea id={`pd-${p.id}`} rows={4} maxLength={2000} value={text} placeholder="What this project is about" onInput={(e) => setText(e.currentTarget.value)}
            onBlur={() => { if (text.trim() !== p.description) void setDescription(p, text.trim()).catch(toastError); }} />
        </FormField>
      </div>
    </div>
  );
}
