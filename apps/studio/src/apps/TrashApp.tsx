import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FILE_TYPE_META, TRASH_RETENTION_DAYS, trashDaysLeft, type TrashEntry } from "@openclapper/vocab";
import * as data from "../data";
import { folderPath, matches } from "../fileTree";
import { bind, useKeys } from "../keys";
import { useProjectId } from "../project";
import { Button, Checkbox, cx, Empty, Icon, Img, Loading, SearchInput, Toolbar, ToolbarSpacer } from "@openclapper/ui";
import type { AppProps } from "./registry";
import { emptyBin, purge, restore } from "./trashOps";

const key = (e: TrashEntry) => `${e.type}:${e.id}`;
const typeLabel = (e: TrashEntry) => (e.type === "folder" ? "Folder" : FILE_TYPE_META[e.type].label);
const typeIcon = (e: TrashEntry) => (e.type === "folder" ? "folder-outline" : FILE_TYPE_META[e.type].icon);
const ago = (iso: string) => {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`;
};

/**
 * The recycle bin (#/trash, epic #90): what was deleted in this project, newest first. Restore
 * puts entries back where they were; Delete permanently and Empty the bin purge them. Anything
 * still here after TRASH_RETENTION_DAYS goes by itself (the Worker's daily cron).
 */
export function TrashApp({ focused, replaceRoute }: AppProps) {
  const projectId = useProjectId()!;
  const d = data.useData();
  const trash = d.trash?.projectId === projectId ? d.trash.entries : null;
  const folders = d.files?.folders ?? [];
  const projectName = d.projects?.find((p) => p.id === projectId)?.name ?? "Project";
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => { replaceRoute({ page: "trash" }); }, []);
  // The bin changes from every window: read it again whenever this one comes to the front.
  useEffect(() => { if (focused) void data.loadTrash(projectId); }, [focused, projectId]);

  const shown = useMemo(() => (trash ?? []).filter((e) => matches(q, e.name, e.sub, typeLabel(e))), [trash, q]);
  // A selection only holds what is still listed.
  useEffect(() => { setSel((s) => { const live = new Set(shown.map(key)); const n = new Set([...s].filter((k) => live.has(k))); return n.size === s.size ? s : n; }); }, [shown]);
  const picked = shown.filter((e) => sel.has(key(e)));
  const items = (list: TrashEntry[]) => list.map((e) => ({ type: e.type, id: e.id }));

  const click = (e: TrashEntry, ev: MouseEvent) => {
    const k = key(e);
    setSel((s) => {
      if (ev.shiftKey && anchor) {
        const a = shown.findIndex((x) => key(x) === anchor), b = shown.findIndex((x) => key(x) === k);
        const n = new Set(s);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) n.add(key(shown[i]));
        return n;
      }
      if (ev.ctrlKey || ev.metaKey) { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }
      return new Set([k]);
    });
    setAnchor(k);
  };
  const toggle = (e: TrashEntry) => { const k = key(e); setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; }); setAnchor(k); };
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const doRestore = (list: TrashEntry[]) => list.length && void run(() => restore(items(list), projectId));
  const doPurge = (list: TrashEntry[]) => list.length && void run(() => purge(items(list), projectId));

  useKeys(bind("trash", {
    search: () => search.current?.focus(),
    all: () => setSel(new Set(shown.map(key))),
    restore: () => { if (!picked.length) return false; doRestore(picked); },
    purge: () => { if (!picked.length) return false; doPurge(picked); },
  }));

  const where = (e: TrashEntry) => (e.folder_id ? folderPath(folders, e.folder_id).map((f) => f.name).join(" › ") || projectName : `${projectName} (top level)`);
  const allOn = shown.length > 0 && picked.length === shown.length;
  return (
    <>
      <Toolbar>
        <Button size="sm" kind="secondary" icon="restore" disabled={busy || !picked.length} kbd="R" onClick={() => doRestore(picked)}>{picked.length > 1 ? `Restore ${picked.length}` : "Restore"}</Button>
        <Button size="sm" kind="danger" icon="delete-forever-outline" disabled={busy || !picked.length} kbd="Del" onClick={() => doPurge(picked)}>Delete permanently</Button>
        <ToolbarSpacer />
        <SearchInput inputRef={search} value={q} placeholder="Search the bin" aria-label="Search the bin" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <Button size="sm" kind="ghost" icon="delete-empty-outline" disabled={busy || !trash?.length} onClick={() => void run(() => emptyBin(projectId))}>Empty the bin</Button>
      </Toolbar>
      <div class="f-app__body">
      <div class="f-scroll" style={{ flex: 1 }}>
        {trash === null ? <Loading /> : trash.length === 0 ? (
          <Empty icon="delete-empty-outline" title="The recycle bin is empty">Deleted files and folders stay here for {TRASH_RETENTION_DAYS} days, then they are removed for good.</Empty>
        ) : shown.length === 0 ? <Empty icon="magnify" title="Nothing found">Nothing in the bin matches “{q}”.</Empty> : (
          <table class="f-table trash__table">
            <thead>
              <tr>
                <th style={{ width: "1%" }}><Checkbox checked={allOn} indeterminate={!allOn && picked.length > 0} aria-label="Select all" onClick={() => setSel(allOn ? new Set() : new Set(shown.map(key)))} /></th>
                <th>Name</th><th>Type</th><th>Was in</th><th>Deleted</th><th>Removed in</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const on = sel.has(key(e));
                const left = trashDaysLeft(e.deleted_at);
                return (
                  <tr key={key(e)} class={cx(on && "is-selected")} aria-selected={on} onClick={(ev) => click(e, ev)} onDblClick={() => doRestore([e])}>
                    <td onClick={(ev) => { ev.stopPropagation(); toggle(e); }}><Checkbox checked={on} aria-label={`Select ${e.name}`} /></td>
                    <td class="is-strong is-wrap">
                      <span class="trash__name">
                        <span class="trash__icon">{e.photo_id ? <Img src={`/api/photos/${e.photo_id}/image`} alt="" loading="lazy" /> : <Icon name={typeIcon(e)} />}</span>
                        <span><b>{e.name}</b>{e.sub && <small class="meta">{e.sub}</small>}</span>
                      </span>
                    </td>
                    <td>{typeLabel(e)}</td>
                    <td class="is-wrap">{where(e)}</td>
                    <td class="num">{ago(e.deleted_at)}</td>
                    <td class={cx("num", left <= 3 && "trash__soon")}>{left === 0 ? "Today" : left === 1 ? "1 day" : `${left} days`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      </div>
    </>
  );
}
