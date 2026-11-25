import { Button, EmptyState } from "@openclapper/design";
import { extensionDef } from "@openclapper/model";
import { launch } from "../apps/registry";

/** What a window of an extension's app shows while the project has that extension off: nothing is lost, it is just not here. */
export function NeedsExtension({ id }: { id: string }) {
  const name = extensionDef(id)?.name ?? id;
  return (
    <div className="oc-app st-center">
      <EmptyState icon="extension" title={`Needs the ${name} extension`}>
        This project has it switched off. Its files and devices are kept.
        <div style={{ marginTop: "var(--space-3)" }}><Button variant="secondary" onClick={() => launch({ app: "settings", state: { tab: "extensions" } })}>Extensions of this project…</Button></div>
      </EmptyState>
    </div>
  );
}
