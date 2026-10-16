import { useEffect, useState } from "preact/hooks";
import type { Shot } from "../api";
import * as data from "../data";
import { useMask } from "../frameMode";
import { META_FIELDS, MetadataPage, type MetaField } from "../MetadataPage";
import { useProjectId } from "../project";
import { parseRoute } from "../router";
import type { AppProps } from "./registry";

/** What a launch hands Metadata: which field the board sorts by (#/metadata/<field>). */
export interface MetadataLaunch { field?: MetaField }

/** Metadata (#/metadata/<field>): drag shots onto one field's values; each drop saves at once. */
export function MetadataApp({ win, replaceRoute, open }: AppProps) {
  const projectId = useProjectId()!;
  const pd = data.useProjectData(projectId);
  const [mask] = useMask();
  const [field, setField] = useState<MetaField>(() => {
    const asked = (win.state as MetadataLaunch | undefined)?.field;
    if (asked && (META_FIELDS as readonly string[]).includes(asked)) return asked;
    const r = win.route ? parseRoute(win.route) : null;
    return r?.page === "metadata" ? r.field : "location";
  });
  useEffect(() => {
    const asked = (win.state as MetadataLaunch | undefined)?.field;
    if (win.stateSeq && asked) setField(asked);
  }, [win.stateSeq]);
  useEffect(() => { replaceRoute({ page: "metadata", field }); }, [field]);

  const openShot = (s: Shot, list: Shot[]) => open({ app: "shot", resource: { type: "shot", id: s.id }, state: { stage: "photo", list: list.map((x) => x.id), line: "From the metadata board", from: win.id } });
  if (!pd.project) return null;
  return (
    <MetadataPage project={pd.project} shots={pd.scoped} locations={pd.locations} onLocations={data.setLocationsOf(projectId)} mask={mask}
      field={field} onField={setField} onUpdated={data.updated} onOpen={openShot} />
  );
}
