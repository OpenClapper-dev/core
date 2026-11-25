/** The Workspaces section (issue #116): every workspace with its owner, members and storage. */
import { Badge, Table } from "@openclapper/design";
import type { AdminWorkspace } from "./api";
import { bytes, day, Section } from "./shared";

export function Workspaces({ list }: { list: AdminWorkspace[] }) {
  return (
    <Section icon="users" title={`Workspaces · ${list.length}`}>
      <div className="adm-scroll">
        <Table columns={[{ key: "name", label: "Workspace" }, { key: "owner", label: "Owner" }, { key: "members", label: "Members", numeric: true }, { key: "projects", label: "Projects", numeric: true }, { key: "files", label: "Files", numeric: true }, { key: "photos", label: "Photos", numeric: true }, { key: "storage", label: "Storage", numeric: true }, { key: "created", label: "Created" }]}
          rows={list.map((w) => ({
            id: w.id,
            name: <span className="adm-who"><strong>{w.name}</strong>{w.kind === "personal" && <Badge>Personal</Badge>}</span>,
            owner: w.owner_email ?? "—", members: w.members, projects: w.projects, files: w.files, photos: w.photos,
            storage: <span title={w.unsized ? `${w.unsized} photos have no recorded size` : undefined}>{bytes(w.bytes)}{w.unsized ? " +" : ""}</span>,
            created: day(w.created_at),
          }))} />
      </div>
    </Section>
  );
}
