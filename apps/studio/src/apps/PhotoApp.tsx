import { useEffect, useState } from "preact/hooks";
import { Button, EmptyState, PropertyList, Spinner, StatusBar, TextInput, Toolbar, ToolbarSpacer, ViewerLayout, useDockLayout } from "@openclapper/design";
import { collectionOf, photosOf } from "../collections";
import { canvasFromPhoto } from "../fileOps";
import * as store from "../files";
import { toastError } from "../hosts";
import { bind, useKeys } from "../keys";
import { imageUrl } from "../media";
import { PhotoFactsSections } from "../photoParts";
import * as wm from "../wm/wm";
import { StartScreen } from "./StartScreen";
import type { AppProps } from "./registry";

/**
 * The Photo app (docs/rewrite/09-shells.md): one photo, large, with its facts. ← and → step through
 * the list it was opened from (or its collection, else its folder). The preview shows at once; the
 * original replaces it as soon as it has loaded.
 */
/** One photo; opened without one, the start screen of the project's photos (#426). */
export function PhotoApp(p: AppProps) {
  return p.resource ? <PhotoView {...p} /> : <StartScreen winId={p.win.id} projectId={p.projectId} type="photo" canCreate={false} setTitle={p.setTitle} setRoute={p.setRoute} />;
}

function PhotoView({ win, resource, projectId, setTitle, setRoute }: AppProps) {
  const { files } = store.useRoot({ project: projectId });
  const all = files ?? [];
  const map = store.byId(all);
  const [id, setId] = useState(resource?.id ?? "");
  useEffect(() => { if (resource?.id) setId(resource.id); }, [resource?.id, win.stateSeq]);
  const f = map.get(id);
  // The preview shows at once; the original replaces it as soon as it has loaded (#426: no Preview / Full size switch).
  const [loaded, setLoaded] = useState<string | null>(null);
  const [name, setName] = useState(f?.name ?? "");
  useEffect(() => { setName(f?.name ?? ""); }, [f?.id, f?.name]);
  const [panels, setPanels] = useDockLayout("photo", { right: { tabs: ["facts"] } });

  // The list to step through: the one it was opened from, else its collection, else its folder.
  const given = (win.state as { list?: string[] } | undefined)?.list;
  const coll = f ? collectionOf(f, map) : undefined;
  const list = given?.length && given.includes(id) ? given.filter((x) => map.get(x)?.type === "photo")
    : coll ? photosOf(coll, all).map((p) => p.id)
    : all.filter((p) => p.type === "photo" && !p.internal_of && p.container === f?.container).sort((a, b) => (a.photo?.taken_at ?? "").localeCompare(b.photo?.taken_at ?? "")).map((p) => p.id);
  const at = list.indexOf(id);
  // The window stands for the photo it shows (one window per file): stepping onto one open elsewhere brings that window up.
  const step = (d: number) => { const next = list[at + d]; if (next && wm.setResource(win.id, { type: "photo", id: next })) setId(next); };
  useEffect(() => { if (f) { setTitle(f.name); setRoute(f.id); } }, [f?.id, f?.name]);
  useKeys(bind("photo", { prev: () => step(-1), next: () => step(1) }));
  const originalUrl = f && f.photo?.stored.original && f.photo.media_type !== "image/heic" ? imageUrl(f.id, "original") : null;
  useEffect(() => {
    if (!originalUrl || loaded === originalUrl) return;
    const img = new Image();
    img.onload = () => setLoaded(originalUrl);
    img.src = originalUrl;
    return () => { img.onload = null; };
  }, [originalUrl]);

  if (!files) return <div className="oc-app st-center"><Spinner /></div>;
  if (!f || f.type !== "photo" || !f.photo) return <div className="oc-app"><EmptyState icon="image" title="This photo is gone">It was deleted, or it is in the recycle bin.</EmptyState></div>;
  const p = f.photo;
  const original = p.stored.original && p.media_type !== "image/heic" ? imageUrl(f.id, "original") : null;
  const first = p.stored.preview ? imageUrl(f.id, "preview") : p.stored.thumbnail ? imageUrl(f.id, "thumbnail") : null;
  const src = original && loaded === original ? original : first ?? original;
  const commit = () => { const to = name.trim(); if (!to || to === f.name) { setName(f.name); return; } void store.rename(f, to).catch((e) => { toastError(e); setName(f.name); }); };
  return (
    <ViewerLayout
      toolbar={(
        <Toolbar>
          <Button size="sm" variant="quiet" icon="chevron-left" label="Previous photo (←)" disabled={at <= 0} onClick={() => step(-1)} />
          <Button size="sm" variant="quiet" icon="chevron-right" label="Next photo (→)" disabled={at < 0 || at >= list.length - 1} onClick={() => step(1)} />
          <TextInput size="sm" value={name} aria-label="Name" maxLength={120} style={{ width: 240 }} onInput={(e) => setName(e.currentTarget.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setName(f.name); e.currentTarget.blur(); } }} />
          <ToolbarSpacer />
          <Button size="sm" variant="quiet" icon="brush" onClick={() => void canvasFromPhoto(f, map)}>Make a canvas</Button>
          <Button size="sm" variant="quiet" icon="download" label="Download the original" disabled={!p.stored.original} onClick={() => { const a = document.createElement("a"); a.href = imageUrl(f.id, "original"); a.download = f.name; a.click(); }} />
        </Toolbar>
      )}
      dock={{ layout: panels, onLayoutChange: setPanels, zoneSizes: { right: 300 }, panels: [{ id: "facts", title: "Properties", icon: "info", body: <div className="st-info"><PropertyList><PhotoFactsSections f={f} map={map} /></PropertyList></div> }] }}
      stage={<div className="st-stage">{src ? <img key={src} src={src} alt={f.name} /> : <EmptyState icon="cloud-upload" title="Not uploaded yet">The preview shows here once it arrived.</EmptyState>}</div>}
      statusBar={<StatusBar>{at >= 0 ? `${at + 1} of ${list.length}` : ""}{coll ? ` · in “${coll.name}”` : ""} · {p.width} × {p.height}{original && loaded !== original ? " · loading the original…" : ""}</StatusBar>}
    />
  );
}
