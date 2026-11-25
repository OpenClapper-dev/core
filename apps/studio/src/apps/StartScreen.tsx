import type { ComponentChildren } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { AppIcon, Button, EmptyState, FileCard, FileGrid, SearchInput, Spinner, Toolbar, ToolbarSpacer } from "@openclapper/design";
import type { FileRec } from "../api";
import * as store from "../files";
import { kindOf } from "../fileKinds";
import { toastError } from "../hosts";
import { thumbOf } from "../photoParts";
import * as wm from "../wm/wm";

/**
 * What a per-file app shows when it is opened without a file (#426), as a desktop program's start
 * screen: the project's files of its type to open in this window, and New. Opening one turns this
 * window into that file's window; one already open elsewhere comes to the front instead.
 */
export function StartScreen({ winId, projectId, type, setTitle, setRoute, extra, canCreate = true, action }: {
  winId: string; projectId: string; type: string; setTitle: (t: string) => void; setRoute: (r: string) => void;
  /** Cards before the files (the master timeline in Timeline). */
  extra?: ComponentChildren;
  canCreate?: boolean;
  /** A button next to New (Import photos in Photo). */
  action?: ComponentChildren;
}) {
  const { files } = store.useRoot({ project: projectId });
  const kind = kindOf(type);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTitle(kind.label); setRoute(""); }, [type]);
  const list = useMemo(() => (files ?? [])
    .filter((f) => f.type === type && !f.internal_of && (!q || f.name.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at)), [files, type, q]);
  const open = (f: FileRec) => { wm.setResource(winId, { type: f.type, id: f.id }); };
  const create = async () => {
    setBusy(true);
    try { const id = crypto.randomUUID(); await store.create({ project: projectId }, type, { id }); wm.setResource(winId, { type, id }); } catch (e) { toastError(e); setBusy(false); }
  };
  if (!files) return <div className="oc-app st-center"><Spinner /></div>;
  return (
    <div className="oc-app st-start">
      <Toolbar>
        <span className="st-start__title"><AppIcon glyph={kind.glyph} color={kind.color} size={24} />{kind.plural}</span>
        <ToolbarSpacer />
        <SearchInput size="sm" placeholder={`Search ${kind.plural.toLowerCase()}`} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        {action}
        {canCreate && <Button size="sm" variant="primary" icon="plus" disabled={busy} onClick={() => void create()}>New {kind.label.toLowerCase()}</Button>}
      </Toolbar>
      <div className="st-scroll st-start__body">
        {!list.length && !extra ? (
          <EmptyState icon={kind.glyph} title={q ? "Nothing matches" : `No ${kind.plural.toLowerCase()} yet`}>{q ? "" : canCreate ? `Make the first one with New ${kind.label.toLowerCase()}.` : ""}</EmptyState>
        ) : (
          <FileGrid>
            {extra}
            {list.map((f) => {
              const thumb = thumbOf(f, files);
              return <FileCard key={f.id} name={f.name} meta={new Date(f.updated_at ?? f.created_at).toLocaleDateString()} art={thumb ? <img src={thumb} alt="" loading="lazy" draggable={false} /> : <AppIcon glyph={kind.glyph} color={kind.color} size={48} />} picture={!!thumb}
                title={`Open ${f.name}`} onClick={() => open(f)} onKeyDown={(e) => { if (e.key === "Enter") open(f); }} />;
            })}
          </FileGrid>
        )}
      </div>
    </div>
  );
}
