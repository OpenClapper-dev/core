import { useRef, useState } from "preact/hooks";
import { AppIcon, Button, EmptyState, SearchInput, StatusBar, Table, Toolbar, ToolbarSpacer } from "@openclapper/design";
import { binDaysLeft } from "@openclapper/model";
import type { Root } from "../api";
import { kindOf } from "../fileKinds";
import * as store from "../files";
import { confirm, toast, toastError } from "../hosts";
import { bind, useKeys } from "../keys";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const count = (n: number, one = "file") => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Empty a root's bin after asking once. */
export async function emptyBin(root: Root, n: number) {
  if (!n) return;
  if (!(await confirm({ title: "Empty the recycle bin?", message: `${count(n, "entry").replace("entrys", "entries")} and what went to the bin with them are deleted for good.`, confirmLabel: "Empty the bin", danger: true }))) return;
  try { await store.emptyBin(root); toast("The recycle bin is empty"); } catch (e) { toastError(e); }
}

/**
 * What is in a root's recycle bin, newest first: where each entry was, when it was deleted and how
 * long it stays. Restoring puts an entry back where it was, with everything that went along, and
 * back everywhere it was used. Shown in the Recycle bin app and inside Files.
 */
export function BinView({ root, keys = true }: { root: Root; keys?: boolean }) {
  const { files, bin } = store.useRoot(root);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [cur, setCur] = useState<string | null>(null);
  const search = useRef<HTMLDivElement>(null);
  const live = store.byId(files ?? []);
  const entries = (bin ?? []).filter((f) => !q || f.name.toLowerCase().includes(q.toLowerCase()));
  const chosen = (sel.length ? sel : cur ? [cur] : []).filter((id) => entries.some((f) => f.id === id));

  const restore = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      const r = await store.restore(root, ids);
      setSel([]); setCur(null);
      toast(`${ids.length === 1 ? `“${bin?.find((f) => f.id === ids[0])?.name ?? "It"}”` : count(ids.length, "entry").replace("entrys", "entries")} restored${r.to_top.length ? `; ${r.to_top.length === ids.length ? "to the top level, its folder is gone" : `${r.to_top.length} to the top level`}` : ""}`);
    } catch (e) { toastError(e); }
  };
  const purge = async (ids: string[]) => {
    if (!ids.length) return;
    const one = ids.length === 1 ? bin?.find((f) => f.id === ids[0]) : null;
    if (!(await confirm({ title: one ? `Delete “${one.name}” for good?` : `Delete ${count(ids.length, "entry").replace("entrys", "entries")} for good?`, message: "This cannot be undone.", confirmLabel: "Delete permanently", danger: true }))) return;
    try { await store.purge(root, ids); setSel([]); setCur(null); } catch (e) { toastError(e); }
  };
  useKeys(bind("bin", {
    search: () => search.current?.querySelector("input")?.focus(),
    all: () => setSel(entries.map((f) => f.id)),
    restore: () => void restore(chosen),
    purge: () => void purge(chosen),
  }), keys);

  return (
    <>
      <Toolbar>
        <strong className="st-title">Recycle bin</strong>
        <ToolbarSpacer />
        <span ref={search}><SearchInput size="sm" value={q} onChange={setQ} placeholder="Names" style={{ width: 170 }} /></span>
        <Button size="sm" icon="history" disabled={!chosen.length} onClick={() => void restore(chosen)}>Restore</Button>
        <Button size="sm" variant="quiet" icon="trash" disabled={!chosen.length} onClick={() => void purge(chosen)}>Delete permanently</Button>
        <Button size="sm" variant="danger" disabled={!(bin ?? []).length} onClick={() => void emptyBin(root, (bin ?? []).length)}>Empty the bin</Button>
      </Toolbar>
      <div className="st-scroll">
        {!bin ? null : !entries.length ? <EmptyState icon={q ? "search" : "trash"} title={q ? `Nothing matches “${q}”` : "The bin is empty"}>{q ? "" : "What is deleted stays here for 30 days."}</EmptyState> : (
          <Table selectable selected={sel} onSelect={setSel} cursor={cur ?? undefined} onCursor={setCur} onOpen={(id) => void restore([id])}
            columns={[{ key: "name", label: "Name" }, { key: "type", label: "Type" }, { key: "was", label: "Was in" }, { key: "when", label: "Deleted", mono: true }, { key: "left", label: "Stays", numeric: true }]}
            rows={entries.map((f) => {
              const k = kindOf(f.type);
              const days = binDaysLeft(f.deleted_at!);
              return {
                id: f.id,
                name: <span className="st-name"><AppIcon glyph={k.glyph} color={k.color} size={20} />{f.name}{!!f.binned_with && <span className="st-note"> · with {count(f.binned_with)}</span>}</span>,
                type: k.label,
                was: f.internal_of ? "Inside another file" : f.container ? live.get(f.container)?.name ?? "A folder that is gone" : "Top level",
                when: when(f.deleted_at!),
                left: days === 0 ? "due" : `${days} d`,
              };
            })} />
        )}
      </div>
      <StatusBar>{count(entries.length, "entry").replace("entrys", "entries")}{chosen.length > 0 && <> · <strong>{chosen.length} chosen</strong></>} · restore: R or a double-click · purged after 30 days</StatusBar>
    </>
  );
}
