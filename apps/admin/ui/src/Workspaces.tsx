/** The Workspaces section (issue #116): every workspace with its owner, members and storage. */
import { ProjectTag } from "@openclapper/ui";
import type { AdminWorkspace } from "./api";
import { bytes, day, Section } from "./shared";

export function Workspaces({ list }: { list: AdminWorkspace[] }) {
  return (
    <Section icon="account-group-outline" title={`Workspaces · ${list.length}`}>
      <div class="admin__scroll">
        <table class="admin-table">
          <thead><tr><th>Workspace</th><th>Owner</th><th>Members</th><th>Projects</th><th>Shots</th><th>Photos</th><th>Storage</th><th>Created</th></tr></thead>
          <tbody>
            {list.map((w) => (
              <tr key={w.id}>
                <td><strong>{w.name}</strong> {w.kind === "personal" && <ProjectTag>Personal</ProjectTag>}</td>
                <td>{w.owner_email ?? "—"}</td>
                <td class="num">{w.members}</td>
                <td class="num">{w.projects}</td>
                <td class="num">{w.shots}</td>
                <td class="num">{w.photos}</td>
                <td class="num" title={w.unsized ? `${w.unsized} photos have no recorded size` : undefined}>{bytes(w.bytes)}{w.unsized ? " +" : ""}</td>
                <td>{day(w.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
