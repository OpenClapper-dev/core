import { useEffect, useState } from "react";
import type { RunState } from "@openclapper/ext-flows";
import { canCall } from "../../../api";
import { useProject } from "../../../projects";
import { Banner, Block, Button, Empty, Header, Hint, ListRow, Screen, toast } from "../../../ui";
import { useHardware } from "../../hardware/proxy";
import { request, useRun } from "../run";
import { hasUnsent, loadFlows, newFlow, useFlows, type LocalFlow } from "../store";
import { FlowEditor } from "./Editor";

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/**
 * Flows on the device (docs/features/flows.md, "On the device"; #426): the project's flows, kept on the device, edited
 * here in the native editor and played on this device's own connections, also without a connection to the server.
 * A saved flow can also run on the device that holds the connections, as the Studio's Run on device does.
 */
export function FlowsApp({ active }: { active: boolean }) {
  const project = useProject();
  const flows = useFlows(project?.id);
  const [open, setOpen] = useState<string | null>(null);
  const run = useRun();
  const { state } = useHardware();
  useEffect(() => { if (active && project) void loadFlows(project.id); }, [active, project?.id]);

  const current = flows.find((f) => f.id === open) ?? null;
  if (current) return <FlowEditor key={current.id} flow={current} back={() => { setOpen(null); if (project) void loadFlows(project.id); }} />;
  const make = () => { if (project) setOpen(newFlow(project.id, flows.length)); };
  return (
    <Screen header={<Header title="Flows" sub={project?.name} actions={[{ icon: "plus", label: "New flow", onPress: make }]} />}>
      <RunBanner run={run} />
      {!flows.length ? <Block><Empty icon="timeline" title="No flows yet" body="Tracks of lights and cameras, keyframes on them, played from this device or the Studio." /><Button icon="plus" label="New flow" onPress={make} /></Block>
        : flows.map((f) => <FlowRow key={f.id} f={f} proxy={!!state?.proxy} run={run} onOpen={() => setOpen(f.id)} />)}
      {!canCall() && flows.length > 0 && <Block><Hint>Offline: the flows as this device last had them. Changes are kept here and saved when the server answers.</Hint></Block>}
    </Screen>
  );
}

function FlowRow({ f, proxy, run, onOpen }: { f: LocalFlow; proxy: boolean; run: RunState | null; onOpen: () => void }) {
  const busy = run?.phase === "playing" || run?.phase === "loading";
  const meta = `${secs(f.body.durationMs)} · ${f.body.tracks.length} track${f.body.tracks.length === 1 ? "" : "s"}${f.body.loop ? " · loops" : ""}${hasUnsent(f.id) ? " · not saved yet" : ""}`;
  // Run on the proxy: it fetches exactly the saved version, so only a flow the server has as it is here.
  const canRun = proxy && !busy && canCall() && f.updatedAt !== null && !hasUnsent(f.id);
  return <ListRow icon="timeline" title={f.name} meta={meta} onPress={onOpen}
    trailing={canRun ? <Button kind="ghost" icon="play" label="Run" onPress={() => { request({ type: "run", flow: f.id, revision: f.updatedAt!, fromMs: 0 }); toast(`Running ${f.name} on the device with the connections`, "neutral"); }} /> : undefined} />;
}

/** A flow running on the device that holds the connections (this one or another), with Stop. */
function RunBanner({ run }: { run: RunState | null }) {
  if (!run || (run.phase !== "playing" && run.phase !== "loading" && run.phase !== "error")) return null;
  return (
    <Block>
      {run.phase === "error" ? <Banner kind="danger" title="Flow not started" meta={run.error} />
        : <Banner kind="ok" icon="play" title={run.phase === "loading" ? "Loading the flow…" : `Running ${run.name ?? "a flow"}`}
          meta={run.phase === "playing" ? `${secs(run.atMs)} / ${secs(run.durationMs ?? 0)}${run.loop ? " · loop" : ""}` : undefined} />}
      {run.phase !== "error" && <Button kind="secondary" icon="stop" label="Stop" onPress={() => request({ type: "stop" })} />}
    </Block>
  );
}
