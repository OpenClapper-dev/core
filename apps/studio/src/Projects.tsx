import { useEffect, useState } from "preact/hooks";
import { deleteProject, existingIdOf, putProject, type FieldDefinition, type Project } from "./api";
import { Button, confirmDialog, Empty, Field, Input, ListRow, Mark, MenuItem, Panel, PanelBody, PanelHead, ProjectTag, promptDialog, SaveStatus, toast, Toolbar, ToolbarSpacer, ToolbarTitle, type SaveState } from "@openclapper/ui";
import { useUser } from "./user";

const sortByName = (list: Project[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

/** Create a project from a name prompt; resolves the saved project or null. */
export async function createProject(projects: Project[], onChange: (p: Project[]) => void): Promise<Project | null> {
  const name = await promptDialog({ title: "New project", input: { label: "Name", placeholder: "e.g. Short film ‘Nachtbus’" }, confirmLabel: "Create" });
  if (!name) return null;
  try {
    const saved = await putProject({ id: crypto.randomUUID(), name, notes: null });
    onChange(sortByName([...projects, saved]));
    return saved;
  } catch (err) {
    toast(existingIdOf(err) ? `A project called “${name}” already exists.` : (err as Error).message, "danger");
    return null;
  }
}

/** First run: nothing chosen yet, so choosing is all the Studio shows. */
export function ProjectGate({ projects, onChange, onActivate }: { projects: Project[]; onChange: (p: Project[]) => void; onActivate: (id: string) => void }) {
  return (
    <div class="gate">
      <div class="gate__card">
        <span class="gate__brand"><Mark size={26} />OpenClapper</span>
        <h1>Which project are you working on?</h1>
        <p class="meta">Everything you see and every shot you edit belongs to the active project. Each project has its own desktop. Switch any time from the taskbar; the choice is remembered.</p>
        <div class="f-menu gate__list">
          {projects.map((p) => <MenuItem key={p.id} icon="folder-outline" count={`${p.shot_count} shots`} onClick={() => onActivate(p.id)}>{p.name}</MenuItem>)}
          {projects.length === 0 && <span class="meta" style={{ padding: "10px" }}>No projects yet. Create the first one.</span>}
        </div>
        <Button icon="plus" onClick={async () => { const p = await createProject(projects, onChange); if (p) onActivate(p.id); }}>New project</Button>
      </div>
    </div>
  );
}

interface Props {
  projects: Project[];
  onChange: (p: Project[]) => void;
  fields: FieldDefinition[];
  scope: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onActivate: (id: string) => void;
  onShowShots: (id: string) => void;
  onEditFields: (projectId: string) => void;
}

/** Library › Projects: list with counts | detail (name, notes, ordered extra fields, delete when empty). */
export function ProjectsPage({ projects, onChange, fields, scope, selectedId, onSelect, onActivate, onShowShots, onEditFields }: Props) {
  const user = useUser();
  // With more than one workspace each project says which it is in.
  const spaces = user.status === "signed-in" && user.me.workspaces.length > 1 ? new Map(user.me.workspaces.map((w) => [w.id, w.name])) : null;
  const selected = projects.find((p) => p.id === selectedId) ?? projects.find((p) => p.id === scope) ?? projects[0] ?? null;
  return (
    <div class="f-app__body">
      <Panel left width="300px" label="Projects">
        <PanelHead title="Projects"><Button size="sm" icon="plus" onClick={async () => { const p = await createProject(projects, onChange); if (p) onSelect(p.id); }}>New project</Button></PanelHead>
        <PanelBody flush role="listbox">
          {projects.map((p) => (
            <ListRow key={p.id} role="option" aria-selected={p.id === selected?.id} selected={p.id === selected?.id} onClick={() => onSelect(p.id)}
              title={p.name}
              meta={`${spaces ? `${spaces.get(p.workspace_id) ?? "Shared"} · ` : ""}${p.shot_count} shot${p.shot_count === 1 ? "" : "s"} · ${p.field_ids.length} field${p.field_ids.length === 1 ? "" : "s"}${p.shot_count === 0 ? " · can be deleted" : ""}`}
              trailing={p.id === scope && <ProjectTag>Active</ProjectTag>} />
          ))}
        </PanelBody>
      </Panel>
      {selected ? <ProjectDetail key={selected.id} project={selected} projects={projects} onChange={onChange} fields={fields} active={selected.id === scope} onActivate={onActivate} onShowShots={onShowShots} onEditFields={onEditFields} onDeleted={() => onSelect(null)} />
        : <Empty icon="folder-outline" title="No projects yet" actions={<Button icon="plus" onClick={() => void createProject(projects, onChange)}>New project</Button>} />}
    </div>
  );
}

function ProjectDetail({ project, projects, onChange, fields, active, onActivate, onShowShots, onEditFields, onDeleted }: { project: Project; projects: Project[]; onChange: (p: Project[]) => void; fields: FieldDefinition[]; active: boolean; onActivate: (id: string) => void; onShowShots: (id: string) => void; onEditFields: (id: string) => void; onDeleted: () => void }) {
  const [name, setName] = useState(project.name);
  const [notes, setNotes] = useState(project.notes ?? "");
  const [save, setSave] = useState<SaveState>("idle");
  const [nameError, setNameError] = useState<string | null>(null);
  useEffect(() => { setName(project.name); setNotes(project.notes ?? ""); }, [project.id]);
  const replace = (p: Project) => onChange(sortByName(projects.map((x) => (x.id === p.id ? p : x))));

  async function saveMeta(n = name, t = notes) {
    if (!n.trim()) { setNameError("A project needs a name."); return; }
    if (n.trim() === project.name && (t.trim() || null) === project.notes) return;
    setSave("saving"); setNameError(null);
    try { const saved = await putProject({ id: project.id, name: n.trim(), notes: t.trim() || null }); replace({ ...saved, field_ids: project.field_ids }); setSave("saved"); }
    catch (err) { setSave("error"); setNameError(existingIdOf(err) ? `A project called “${n.trim()}” already exists. Names are unique, ignoring case.` : (err as Error).message); }
  }
  async function remove() {
    const ok = await confirmDialog({ title: `Delete “${project.name}”?`, body: "The project is empty; nothing else is removed.", confirmLabel: "Delete project", danger: true });
    if (!ok) return;
    try { await deleteProject(project.id); onChange(projects.filter((x) => x.id !== project.id)); onDeleted(); toast("Project deleted"); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }
  const own = project.field_ids.map((id) => fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => !!f);

  return (
    <div class="f-scroll">
      <Toolbar>
        <ToolbarTitle>{project.name}</ToolbarTitle>
        <SaveStatus state={save} onRetry={() => void saveMeta()} />
        <ToolbarSpacer />
        <Button kind="secondary" size="sm" icon="view-grid-outline" onClick={() => onShowShots(project.id)}>Show {project.shot_count} shots</Button>
        {!active && <Button kind="secondary" size="sm" icon="swap-horizontal" onClick={() => onActivate(project.id)}>Make active</Button>}
      </Toolbar>
      <div class="detail-form">
        <Field label="Name" error={nameError}>
          <Input invalid={!!nameError} value={name} maxLength={80} onInput={(e) => setName((e.target as HTMLInputElement).value)} onBlur={() => void saveMeta()} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        </Field>
        <Field label="Notes"><textarea class="f-textarea" rows={3} value={notes} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} onBlur={() => void saveMeta()} /></Field>
        <div class="f-field" style={{ gap: "8px" }}>
          <div class="btn-row"><span class="f-field__label" style={{ flex: 1 }}>Extra fields, in order</span><a href="#" style={{ fontSize: "var(--text-caption)" }} onClick={(e) => { e.preventDefault(); onEditFields(project.id); }}>{active ? "Edit fields" : "Make active and edit fields"}</a></div>
          {own.length > 0 ? (
            <div class="list-box">
              {own.map((f) => <ListRow key={f.id} as="div" style={{ cursor: "default" }} title={f.definition.label} meta={`${f.key} · ${f.definition.type}`} metaClass="mono" />)}
            </div>
          ) : <span class="meta">No extra fields in this project yet. They belong to it alone; define them in Library › Fields.</span>}
        </div>
        <div class="danger-zone">
          <Button kind="danger" icon="delete-outline" disabled={project.shot_count > 0} onClick={() => void remove()}>Delete project</Button>
          {project.shot_count > 0 && <span class="meta">Only empty projects can be deleted. Move or delete its {project.shot_count} shots first.</span>}
        </div>
      </div>
    </div>
  );
}
