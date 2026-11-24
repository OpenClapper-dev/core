import { useEffect, useState } from "preact/hooks";
import { Badge, Button, EmptyState, FormField, PropertyList, PropertyRow, PropertySection, Segmented, Select, SettingsGroup, SettingsLayout, Table, TextInput } from "@openclapper/design";
import { ApiError } from "../api";
import { confirm, prompt, toast, toastError } from "../hosts";
import { switchProject } from "../project";
import { removeProject, saveProject, setCanvasLive, useProjects } from "../projects";
import { useUser } from "../user";
import { useCatalogue } from "../props";
import type { AppProps } from "./registry";
import { NamingPage } from "./project/Naming";
import { PropertiesPage } from "./project/Properties";
import "../catalogue.css";

const TABS = ["general", "properties", "naming", "projects"] as const;
const TITLES: Record<string, string> = { properties: "Properties", naming: "Naming patterns" };
type Tab = (typeof TABS)[number];
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
/** A name the server refused because it is taken reads better than "409". */
const nameTaken = (e: unknown) => e instanceof ApiError && e.status === 409;

/**
 * The Project app (docs/rewrite/09-shells.md): this project's own settings, and switching and
 * managing projects; the property catalogue and the naming patterns (docs/features/properties.md).
 * Extensions join it with their build step.
 */
export function ProjectApp({ win, projectId, setTitle, setRoute }: AppProps) {
  const asked = (win.state as { tab?: string } | undefined)?.tab;
  const [tab, setTab] = useState<Tab>(TABS.includes(asked as Tab) ? (asked as Tab) : "general");
  // Launched again (a link, the palette): the tab it names, or the first one.
  useEffect(() => { if (win.stateSeq) setTab(TABS.includes(asked as Tab) ? (asked as Tab) : TABS[0]); }, [win.stateSeq]);
  const { list } = useProjects();
  const user = useUser();
  const projects = list ?? [];
  const current = projects.find((p) => p.id === projectId);
  const workspaces = user.status === "signed-in" ? user.me.workspaces : [];
  const wsName = (id: string) => workspaces.find((w) => w.id === id)?.name ?? "—";
  const catalogue = useCatalogue(projectId);
  useEffect(() => { setTitle(tab === "projects" ? "Projects" : current ? `Project · ${TITLES[tab] ?? current.name}` : "Project"); setRoute(tab === "general" ? "" : tab); }, [tab, current?.name]);

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
    <SettingsLayout value={tab} onChange={(id) => setTab(id as Tab)}
      sections={[{ label: "This project", items: [{ id: "general", label: "General", icon: "slate" }, { id: "properties", label: "Properties", icon: "tag" }, { id: "naming", label: "Naming patterns", icon: "edit" }] }, { label: "All projects", items: [{ id: "projects", label: "Projects", icon: "folder" }] }]}
      wide={tab === "properties" || tab === "naming"}
      title={tab === "projects" ? "Projects" : TITLES[tab] ?? current?.name ?? "Project"}>
      {tab === "properties" && <PropertiesPage projectId={projectId} files={catalogue.files} defs={catalogue.defs} />}
      {tab === "naming" && <NamingPage projectId={projectId} files={catalogue.files} patterns={catalogue.patterns} />}
      {tab === "general" && current && (
        <>
          <SettingsGroup title="Name">
            <FormField label="Project name" htmlFor={`pn-${win.id}`} error={wrong ?? undefined} hint="Unique within its workspace.">
              <span className="st-inline">
                <TextInput id={`pn-${win.id}`} value={name} invalid={!!wrong} maxLength={80} style={{ flex: 1 }} onInput={(e) => { setName(e.currentTarget.value); setWrong(null); }} onKeyDown={(e) => { if (e.key === "Enter") void saveName(); }} />
                <Button variant="primary" disabled={!name.trim() || name.trim() === current.name} onClick={() => void saveName()}>Rename</Button>
              </span>
            </FormField>
          </SettingsGroup>
          <SettingsGroup title="Canvases while someone edits them">
            <Segmented label="Live updates" value={current.canvas_live ?? "realtime"} onChange={(v) => void setCanvasLive(current, v as "realtime" | "gradual").catch(toastError)}
              options={[{ value: "realtime", label: "Realtime" }, { value: "gradual", label: "Every 5 seconds" }]} />
            <p className="st-note">{(current.canvas_live ?? "realtime") === "realtime"
              ? "Everyone watching a canvas sees each change and each stroke as it is drawn, and sees at once when the person editing lets it go. It runs on a Durable Object per open canvas, which counts against the Cloudflare plan."
              : "Everyone watching a canvas sees it as it was saved, read again every 5 seconds, and sees within 5 seconds when it is free to edit. It only reads the database."}</p>
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
                <PropertyRow label="Settings" value="Holds the project's properties and naming patterns" />
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
          {projects.length === 0 ? <EmptyState icon="slate" title="No project yet" /> : (
            <Table className="st-projects" cursor={projectId} onOpen={(id) => void open(id)}
              columns={[{ key: "name", label: "Name" }, { key: "ws", label: "Workspace" }, { key: "files", label: "Files", numeric: true }, { key: "created", label: "Created" }, { key: "act", label: "", width: 190 }]}
              rows={projects.map((p) => ({
                id: p.id,
                name: <span className="st-inline"><strong>{p.name}</strong>{p.id === projectId && <Badge tone="accent">Open</Badge>}</span>,
                ws: wsName(p.workspace_id), files: String(p.file_count), created: day(p.created_at),
                act: <span className="st-inline st-inline--end">
                  {p.id !== projectId && <Button size="sm" onClick={() => void open(p.id)}>Open</Button>}
                  <Button size="sm" variant="quiet" icon="edit" label={`Rename ${p.name}`} onClick={() => void askRename(p.id, p.name)} />
                  <Button size="sm" variant="quiet" icon="trash" label={`Delete ${p.name}`} onClick={() => void remove(p.id)} />
                </span>,
              }))} />
          )}
        </>
      )}
    </SettingsLayout>
  );
}
