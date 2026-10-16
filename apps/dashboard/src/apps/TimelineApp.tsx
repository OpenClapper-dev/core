import { useEffect, useState } from "preact/hooks";
import type { Shot } from "../api";
import * as data from "../data";
import { useMask } from "../frameMode";
import { useProjectId } from "../project";
import { parseRoute, type CutPosition } from "../router";
import { TimelinePage } from "../Timeline";
import { confirmDialog, type SaveState } from "../ui";
import { openOverlay } from "../wm/overlays";
import type { AppProps } from "./registry";
import { useAppGuard } from "./useAppGuard";

/** What a launch hands the Timeline: which cut, and where in it (#/timeline/<id>?t=&tool=). */
export interface TimelineLaunch { timelineId?: string | null; at?: CutPosition | null }

/** From a launch, else the window's own route (a restored desktop). */
function initial(win: AppProps["win"]): TimelineLaunch {
  const st = win.state as TimelineLaunch | undefined;
  if (st && "timelineId" in st) return st;
  const r = win.route ? parseRoute(win.route) : null;
  return r?.page === "timeline" ? { timelineId: r.timelineId, at: r.at } : {};
}

/**
 * Timeline (#/timeline): one window for the project's cuts (rail, stage, strip, browser), the cut
 * picked inside it. A single window on purpose: each page keeps its own copy of every timeline,
 * so two windows could overwrite each other's autosaves (docs/known-issues.md).
 */
export function TimelineApp({ win, setTitle, replaceRoute, open }: AppProps) {
  const projectId = useProjectId()!;
  const pd = data.useProjectData(projectId);
  const [mask] = useMask();
  const [timelineId, setTimelineId] = useState<string | null>(() => initial(win).timelineId ?? null);
  const [at, setAt] = useState<CutPosition | null>(() => initial(win).at ?? null);
  const [save, setSave] = useState<SaveState>("idle");
  // Re-launched with a cut (a deep link, the inspector, ⌘K): switch to it, at its position.
  useEffect(() => {
    if (!win.stateSeq) return;
    const st = win.state as TimelineLaunch | undefined;
    if (st && "timelineId" in st) { setAt(st.at ?? null); setTimelineId(st.timelineId ?? null); }
  }, [win.stateSeq]);
  useEffect(() => { replaceRoute({ page: "timeline", timelineId }); }, [timelineId]);
  useAppGuard(win.id, save === "error", async () => (await confirmDialog({ title: "Close with unsaved changes?", body: "The last changes to the timeline could not be saved. Closing drops them.", confirmLabel: "Close anyway", danger: true })) === true);

  const openShot = (s: Shot, list: Shot[]) => open({ app: "shot", resource: { type: "shot", id: s.id }, state: { stage: "photo", list: list.map((x) => x.id), line: "Shots in the timeline", from: win.id } });
  if (!pd.project || !pd.data.presets) return null;
  return (
    <TimelinePage key={win.stateSeq ?? 0} project={pd.project} shots={pd.scoped} presets={pd.data.presets} mask={mask} timelineId={timelineId} at={at}
      onTimeline={(id) => { setAt(null); setTimelineId(id); }} onOpen={openShot} onUpdated={data.updated}
      onShowOnMap={(s) => open({ app: "gallery", state: { showShot: s.id } })} onNewShot={() => openOverlay("newShot")}
      onStatus={(s) => { setSave(s.save); setTitle(s.name ? `Timeline · ${s.name}` : "Timeline"); }}
      onCutPosition={(pos) => replaceRoute({ page: "timeline", timelineId, at: pos })} />
  );
}
