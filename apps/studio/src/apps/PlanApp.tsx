import { useEffect, useState } from "preact/hooks";
import type { Shot } from "../api";
import * as data from "../data";
import { useMask } from "../frameMode";
import { PlanPage } from "../Plan";
import { useProjectId } from "../project";
import { parseRoute } from "../router";
import { confirmDialog, type SaveState } from "@openclapper/ui";
import type { AppProps } from "./registry";
import { useAppGuard } from "./useAppGuard";

/** What a launch hands Plan: which shooting day (#/plan/<dayId>). */
export interface PlanLaunch { dayId?: string | null }

/**
 * Plan (#/plan): the project's shooting days in one window, the day picked inside it. A single
 * window for the same reason as Timeline: each page keeps its own copy of every day.
 */
export function PlanApp({ win, setTitle, replaceRoute, open }: AppProps) {
  const projectId = useProjectId()!;
  const pd = data.useProjectData(projectId);
  const [mask] = useMask();
  const [dayId, setDayId] = useState<string | null>(() => {
    const st = win.state as PlanLaunch | undefined;
    if (st && "dayId" in st) return st.dayId ?? null;
    const r = win.route ? parseRoute(win.route) : null;
    return r?.page === "plan" ? r.dayId : null;
  });
  const [save, setSave] = useState<SaveState>("idle");
  useEffect(() => {
    const st = win.state as PlanLaunch | undefined;
    if (win.stateSeq && st && "dayId" in st) setDayId(st.dayId ?? null);
  }, [win.stateSeq]);
  useEffect(() => { replaceRoute({ page: "plan", dayId }); }, [dayId]);
  useAppGuard(win.id, save === "error", async () => (await confirmDialog({ title: "Close with unsaved changes?", body: "The last changes to the day could not be saved. Closing drops them.", confirmLabel: "Close anyway", danger: true })) === true);

  const openShot = (s: Shot, list: Shot[]) => open({ app: "shot", resource: { type: "shot", id: s.id }, state: { stage: "photo", list: list.map((x) => x.id), line: "Planned shots of the day", from: win.id } });
  if (!pd.project) return null;
  return (
    <PlanPage project={pd.project} shots={pd.scoped} mask={mask} dayId={dayId} onDay={setDayId} onOpen={openShot}
      onStatus={(s) => { setSave(s.save); setTitle(s.name ? `Plan · ${s.name}` : "Plan"); }} />
  );
}
