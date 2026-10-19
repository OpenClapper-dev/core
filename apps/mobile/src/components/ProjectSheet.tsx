import { useState } from "react";
import { Text } from "react-native";
import * as Crypto from "expo-crypto";
import type { ProjectEntry } from "../types";
import { Button, Hint, Input, ListRow, makeStyles, Sheet, SheetList, type } from "../ui";

/** Picked an existing project, or created one (`created` is then the new entry, not yet synced). */
export type PickProject = (id: string, created: ProjectEntry | null) => void;

/** Above this many projects the sheet gets a search field. */
const SEARCH_FROM = 8;

export function projectMeta(p: ProjectEntry): string | undefined {
  return p.synced ? undefined : "Not synced yet · created on the phone";
}

/** Project sheet (header pill, HUD project chip, Setup → Project): tap = switch + close. */
export function ProjectSheet({ visible, projects, activeId, onPick, onClose }: { visible: boolean; projects: ProjectEntry[]; activeId: string | null; onPick: PickProject; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const query = q.trim().toLowerCase();
  const shown = query ? projects.filter((p) => p.name.toLowerCase().includes(query)) : projects;
  if (creating) return <NewProjectSheet visible={visible} projects={projects} onPick={(id, p) => { setCreating(false); onPick(id, p); }} onClose={() => setCreating(false)} />;
  return (
    <Sheet visible={visible} title="Project" sub="Every shot goes into the active project" onClose={onClose} height={0.7}
      footer={<Button kind="secondary" icon="plus" label="New project" onPress={() => setCreating(true)} />}>
      {projects.length > SEARCH_FROM && <Input value={q} onChangeText={setQ} placeholder="Search projects" autoCapitalize="none" />}
      <SheetList flushTop={false}>
        {shown.map((p) => (
          <ListRow key={p.id} icon={p.synced ? "folder-outline" : "folder-sync-outline"} title={p.name} meta={projectMeta(p)} selected={p.id === activeId} trailing={null}
            onPress={() => { setQ(""); onPick(p.id, null); }} />
        ))}
      </SheetList>
      {shown.length === 0 && <Hint>{projects.length ? "No project matches." : "No projects yet. Create the first one."}</Hint>}
    </Sheet>
  );
}

/** Name only on the phone (notes and fields stay in the Studio). A name that exists opens that project. */
export function NewProjectSheet({ visible, projects, onPick, onClose }: { visible: boolean; projects: ProjectEntry[]; onPick: PickProject; onClose: () => void }) {
  const s = useStyles();
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const clash = projects.find((p) => p.name.trim().toLowerCase() === trimmed.toLowerCase());
  const create = () => {
    if (!trimmed) return;
    setName("");
    if (clash) { onPick(clash.id, null); return; }
    const p: ProjectEntry = { id: Crypto.randomUUID(), name: trimmed, createdAt: new Date().toISOString(), synced: false };
    onPick(p.id, p);
  };
  return (
    <Sheet visible={visible} title="New project" onClose={onClose} leadLabel="Cancel" doneLabel={null}
      footer={<Button icon={clash ? "folder-outline" : "plus"} label={clash ? `Open “${clash.name}”` : "Create and use"} onPress={create} disabled={!trimmed} />}>
      <Text style={s.label}>Name</Text>
      <Input value={name} onChangeText={setName} placeholder="e.g. Nachtfalter" autoCapitalize="sentences" autoFocus onSubmitEditing={create} maxLength={80} returnKeyType="done" />
      <Hint>{clash ? `“${clash.name}” already exists; this opens it.` : "Works offline; it syncs with the next upload. Notes and extra fields are set in the Studio."}</Hint>
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  label: { ...type("small", "semibold"), color: c.textDim },
}));
