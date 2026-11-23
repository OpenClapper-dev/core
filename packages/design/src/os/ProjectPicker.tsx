import type { JSX } from "preact";
import { Button } from "../actions/Button";
import { Avatar } from "../core/Avatar";
import { ListRow } from "../data/ListRow";
import { cx } from "../util";
import { EnvMarker } from "./EnvMarker";

/** The project picker boot screen, shown after sign-in. */
export interface ProjectPickerProps extends JSX.HTMLAttributes<HTMLDivElement> {
  projects: { id: string; name: string; meta?: string }[];
  user?: string;
  env?: "production" | "staging" | "development";
  onPick?: (id: string) => void;
  onNew?: () => void;
  onSignOut?: () => void;
}

export function ProjectPicker({ projects = [], user, env, onPick, onNew, onSignOut, className, ...rest }: ProjectPickerProps) {
  return (
    <div className={cx("oc-boot", className)} {...rest}>
      <div className="oc-boot__panel">
        <div className="oc-boot__head"><span className="oc-boot__brand">Projects</span>{env && env !== "production" && <EnvMarker env={env} />}</div>
        <p className="oc-boot__sub">Open a project to start the desktop</p>
        <ul role="listbox" className="oc-list oc-boot__list">
          {projects.map((p) => <ListRow key={p.id} size="lg" icon="film" meta={p.meta} chevron onClick={() => onPick && onPick(p.id)}>{p.name}</ListRow>)}
        </ul>
        <div className="oc-boot__foot">
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-3)" }}>{user && <Avatar name={user} size="sm" />}{user}{onSignOut && <Button variant="quiet" size="sm" onClick={onSignOut}>Sign out</Button>}</span>
          <Button icon="plus" onClick={onNew}>New project</Button>
        </div>
      </div>
    </div>
  );
}
