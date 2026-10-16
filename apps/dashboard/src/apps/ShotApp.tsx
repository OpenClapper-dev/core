import { useEffect, useMemo, useState } from "preact/hooks";
import type { Shot } from "../api";
import * as data from "../data";
import { getMask } from "../frameMode";
import type { MaskMode } from "../Framed";
import { getProjectId, switchProject } from "../project";
import { parseRoute, type Stage } from "../router";
import { shotTitle } from "../format";
import { ShotView } from "../ShotView";
import { emptyQuery, runQuery } from "../shotsQuery";
import { Button, Empty } from "../ui";
import * as wm from "../wm/wm";
import type { AppProps } from "./registry";

/** What a launch hands a shot window: the list behind ←/→, where it came from, the stage. */
export interface ShotLaunch {
  stage?: Stage;
  /** Shot ids in order (the Gallery's result, a day's plan, a cut's shots). */
  list?: string[];
  /** The context line under the toolbar ("All states · Dusk exteriors · newest first"). */
  line?: string;
  /** The window that opened it: Esc returns there. */
  from?: string;
}

const STAGES: readonly Stage[] = ["photo", "rigs", "position", "compose"];

/**
 * One shot in a window (#/shots/<id>), resource = the shot: the stage, the inspector, ←/→
 * through the list it was opened from (moving re-targets this window). Esc closes it and goes
 * back to the window it came from.
 */
export function ShotApp({ win, resource, setTitle, replaceRoute, open, close }: AppProps) {
  const d = data.useData();
  const launch = (win.state as ShotLaunch | undefined) ?? {};
  const [stage, setStageState] = useState<Stage>(() => {
    if (launch.stage && STAGES.includes(launch.stage)) return launch.stage;
    const r = win.route ? parseRoute(win.route) : null;
    return r?.page === "shot" ? r.stage : "photo";
  });
  /** The window starts from the global frame mode; a change here sticks for ←/→ while it is open. */
  const [mode, setMode] = useState<MaskMode>(getMask);
  const [ids, setIds] = useState<string[] | null>(launch.list ?? null);
  useEffect(() => {
    if (!win.stateSeq) return;
    if (launch.stage) setStageState(launch.stage);
    if (launch.list) setIds(launch.list);
  }, [win.stateSeq]);

  const shotId = resource?.id ?? "";
  const shot = d.shots?.find((s) => s.id === shotId) ?? null;
  const byId = useMemo(() => new Map((d.shots ?? []).map((s) => [s.id, s])), [d.shots]);
  // Without a list (a deep link), ←/→ walk the project's shots, newest first, as the Gallery would.
  const fallback = useMemo(() => (shot ? runQuery((d.shots ?? []).filter((s) => s.project_id === shot.project_id), emptyQuery(), []).shots : []), [d.shots, shot?.project_id]);
  const fromList = (ids ?? []).map((id) => byId.get(id)).filter((s): s is Shot => !!s);
  const list = shot && fromList.some((s) => s.id === shot.id) ? fromList : fallback;

  useEffect(() => { if (shot) replaceRoute({ page: "shot", shotId: shot.id, stage }); }, [shot?.id, stage]);
  useEffect(() => { setTitle(shot ? shotTitle(shot) : "Shot"); }, [shot?.id, shot?.name]);

  const setStage = (st: Stage) => setStageState(st);
  const navigate = (s: Shot) => { if (wm.setResource(win.id, { type: "shot", id: s.id })) setStageState(stage === "compose" ? "compose" : "photo"); };
  const back = () => {
    const from = launch.from && wm.getWindows().some((w) => w.id === launch.from) ? launch.from : null;
    close();
    if (from) wm.focus(from);
  };
  /** Days and timelines live in a project: jumping to another project's switches the desktop first. */
  const inProject = async (projectId: string, go: () => void) => { if (projectId === getProjectId() || (await switchProject(projectId))) go(); };
  const fromName = launch.from ? wm.getWindows().find((w) => w.id === launch.from)?.title : null;

  if (!d.shots) return null;
  if (!shot) {
    return <Empty icon="image-off-outline" title="Shot not found" actions={<Button kind="secondary" onClick={close}>Close</Button>}>It may have been deleted, or it belongs to another project.</Empty>;
  }
  return (
    <ShotView shot={shot} list={list} onNavigate={navigate}
      context={{ line: launch.line ?? (fromName ? `From ${fromName}` : "Shots of the project, newest first"), onBack: back, backLabel: fromName ? `Back to ${fromName.split(" · ")[0]}` : "Close" }}
      stage={stage} onStage={setStage} mode={mode} onMode={setMode}
      projects={d.projects ?? []} presets={d.presets ?? []} fieldsOf={data.fieldsOf} locations={data.locationsOf(shot.project_id, d)} onLocations={data.setLocationsOf(shot.project_id)}
      spots={d.spots ?? []} onSpots={(update) => data.setSpots((cur) => update(cur ?? []))}
      onUpdated={data.updated}
      onDeleted={(id) => {
        const i = list.findIndex((s) => s.id === id);
        const n = list[i + 1] ?? list[i - 1];
        data.deleted([id]);
        if (n) navigate(n); else back();
      }}
      onShowOnMap={(s) => open({ app: "gallery", state: { showShot: s.id } })}
      onOpenDay={(projectId, dayId) => void inProject(projectId, () => open({ app: "plan", state: { dayId } }))}
      onOpenTimeline={(projectId, timelineId) => void inProject(projectId, () => open({ app: "timeline", state: { timelineId } }))} />
  );
}
