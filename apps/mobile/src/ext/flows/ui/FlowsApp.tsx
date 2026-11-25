import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { randomUUID } from "expo-crypto";
import { modelOf } from "@openclapper/ext-hardware";
import { emptyFlow, type FlowBody, type RunState } from "@openclapper/ext-flows";
import { authHeaders, canCall, listFiles, putFile, webUrl, type FileRec } from "../../../api";
import { log } from "../../../log";
import { useProject } from "../../../projects";
import { useBack } from "../../../shell/back";
import { Banner, Block, Button, Empty, Header, Hint, ListRow, makeStyles, Screen, SectionLabel, toast, type, useTheme } from "../../../ui";
import { useHardware } from "../../hardware/proxy";
import { request, useRun } from "../run";

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const bodyOf = (f: FileRec): FlowBody => ({ ...emptyFlow(), ...(f.body as Partial<FlowBody>) });

/**
 * Flows on the phone and tablet (docs/features/flows.md, "On the device"): the project's flows, run on the phone itself
 * as on set (through the phone that holds the connections), and the Studio's flow editor in a web view, the one editor
 * for every client.
 */
export function FlowsApp({ active }: { active: boolean }) {
  const project = useProject();
  const [flows, setFlows] = useState<FileRec[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const run = useRun();
  const { state } = useHardware();
  const load = () => {
    if (!project || !canCall()) { setFlows([]); return; }
    listFiles({ project_id: project.id }, { type: "flow", body: true }).then((l) => setFlows(l.sort((a, b) => a.name.localeCompare(b.name))), (e) => { log("info", "flows not loaded", { error: e }); setFlows([]); });
  };
  useEffect(() => { if (active) load(); }, [active, project?.id]);
  useBack(editing ? () => { setEditing(null); load(); } : open ? () => setOpen(null) : null, active);

  const make = async () => {
    if (!project || !canCall()) { toast("A new flow needs a connection", "danger"); return; }
    try { const id = randomUUID(); await putFile(id, { type: "flow", project_id: project.id, name: `Flow ${(flows?.length ?? 0) + 1}`, body: emptyFlow() as unknown as Record<string, unknown> }); load(); setEditing(id); }
    catch (e) { toast(`No flow: ${(e as Error).message}`, "danger"); }
  };
  const current = flows?.find((f) => f.id === (editing ?? open)) ?? null;
  if (editing && current) return <FlowWeb id={current.id} name={current.name} onClose={() => { setEditing(null); load(); }} />;
  if (open && current) return <FlowPage f={current} run={run} proxy={!!state?.proxy} back={() => setOpen(null)} onEdit={() => setEditing(current.id)} />;
  return (
    <Screen header={<Header title="Flows" sub={project?.name} actions={[{ icon: "plus", label: "New flow", onPress: () => void make() }]} />}>
      <RunBanner run={run} />
      {!state?.proxy && <Block><Hint>Running a flow needs a device that holds the connections: switch its proxy on in Hardware.</Hint></Block>}
      {flows === null ? <ActivityIndicator style={{ marginTop: 24 }} />
        : !flows.length ? <Block><Empty icon="timeline" title="No flows yet" body="Tracks of lights and cameras, keyframes on them, played from here or the Studio." /><Button icon="plus" label="New flow" onPress={() => void make()} /></Block>
        : flows.map((f) => { const b = bodyOf(f); return <ListRow key={f.id} icon="timeline" title={f.name} meta={`${secs(b.durationMs)} · ${b.tracks.length} track${b.tracks.length === 1 ? "" : "s"}${b.loop ? " · loops" : ""}${run?.flow === f.id && run.phase === "playing" ? " · running" : ""}`} onPress={() => setOpen(f.id)} />; })}
    </Screen>
  );
}

/** A flow running on the phone (this one or the proxy phone), with Stop. */
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

/** One flow: what it drives, run it on the device, open it in the editor. */
function FlowPage({ f, run, proxy, back, onEdit }: { f: FileRec; run: RunState | null; proxy: boolean; back: () => void; onEdit: () => void }) {
  const s = useStyles();
  const b = bodyOf(f);
  const runsThis = run?.flow === f.id && (run.phase === "playing" || run.phase === "loading");
  const busy = run?.phase === "playing" || run?.phase === "loading";
  return (
    <Screen header={<Header title={f.name} sub={`Flow · ${secs(b.durationMs)}${b.loop ? " · loops" : ""}`} onBack={back} actions={[{ icon: "edit", label: "Edit the flow", onPress: onEdit }]} />}>
      <RunBanner run={run} />
      <Block>
        <Button icon="play" label={runsThis ? "Running" : "Run on the device"} disabled={!proxy || busy || !canCall()} onPress={() => request({ type: "run", flow: f.id, revision: f.updated_at, fromMs: 0 })} />
        <Hint>{proxy ? "The device that holds the connections plays it on its own clock, as on set; it keeps playing when the Studio closes." : "No device holds the connections: switch the proxy on in Hardware."}</Hint>
      </Block>
      <Block>
        <SectionLabel>{`${b.tracks.length} track${b.tracks.length === 1 ? "" : "s"}`}</SectionLabel>
        {b.tracks.map((t) => { const m = modelOf(t.model); return <ListRow key={t.id} icon={m?.type === "camera" ? "video" : "light-fixture"} title={t.name} meta={`${m ? `${m.brand} ${m.model}` : t.model} · ${t.keyframes.length} keyframes${t.device ? "" : " · no device"}${t.muted ? " · muted" : ""}`} />; })}
        {!b.tracks.length && <Text style={s.dim}>No tracks yet: add them in the editor.</Text>}
      </Block>
      <Block><Button kind="secondary" icon="edit" label="Edit the flow" onPress={onEdit} /><Hint>The same editor as the Studio's; one person edits a flow at a time.</Hint></Block>
    </Screen>
  );
}

/** The Studio's flow editor in a web view, as the tablet's canvas (the session goes as for the canvas). */
function FlowWeb({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { name: theme } = useTheme();
  const s = useStyles();
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={{ flex: 1 }}>
      <Header title={name} sub="Flow · saves on its own" onBack={onClose} />
      {error ? <Block><Text style={s.err}>{error}</Text><Hint>The editor needs a connection to the server.</Hint></Block> : (
        <WebView source={{ uri: webUrl(`/#/embed/flow/${id}?theme=${theme}`), headers: authHeaders() }} style={{ flex: 1 }} sharedCookiesEnabled thirdPartyCookiesEnabled={false}
          setSupportMultipleWindows={false} startInLoadingState renderLoading={() => <ActivityIndicator style={{ marginTop: 32 }} />}
          onError={(e) => setError(e.nativeEvent.description || "The editor could not be opened")} onHttpError={(e) => setError(`The server answered ${e.nativeEvent.statusCode}`)} />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  dim: { ...type("caption"), color: c.textDim, paddingHorizontal: 16 },
  err: { ...type("body", "semibold"), color: c.danger },
}));
