import { Badge, EmptyState, SettingsGroup, Switch } from "@openclapper/design";
import { extensionDef, extensionDefs } from "@openclapper/model";
import type { Project } from "../../api";
import { toastError } from "../../hosts";
import { setExtension } from "../../projects";

/**
 * The project's extensions (docs/rewrite/08-extensions.md): a switch per extension and what it brings.
 * Everyone in the project sees the same; switching one off deletes nothing, its files show as needing it.
 */
export function ExtensionsPage({ project }: { project: Project }) {
  const on = project.extensions ?? [];
  const defs = extensionDefs();
  if (!defs.length) return <EmptyState icon="extension" title="No extensions in this build" />;
  return (
    <>
      <p className="st-note">Extensions add expert features to this project for everyone in it. Switched off, nothing is deleted: their files and devices stay and show as needing the extension.</p>
      {defs.map((e) => {
        const needs = e.needs.map((n) => extensionDef(n)?.name ?? n);
        const neededBy = defs.filter((x) => x.needs.includes(e.id) && on.includes(x.id)).map((x) => x.name);
        return (
          <SettingsGroup key={e.id} title={e.name}>
            <Switch checked={on.includes(e.id)} onChange={(v: boolean) => void setExtension(project, e.id, v).catch(toastError)}>{e.about}</Switch>
            <ul className="pc-brings">{e.brings.map((b) => <li key={b}>{b}</li>)}</ul>
            {needs.length > 0 && <p className="st-note"><Badge>Needs {needs.join(", ")}</Badge> switched on with it.</p>}
            {neededBy.length > 0 && <p className="st-note">Switching it off also switches off {neededBy.join(", ")}.</p>}
          </SettingsGroup>
        );
      })}
    </>
  );
}
