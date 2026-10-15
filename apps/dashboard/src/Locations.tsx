import { useEffect, useRef, useState } from "preact/hooks";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ApiError, deleteLocation, putLocation, type Location, type Shot } from "./api";
import { ownPositionOf, shotTitle } from "./format";
import { useKeys } from "./keys";
import { Button, confirmDialog, cx, ErrorLine, IconButton, Input, Kbd, Modal, SearchInput, toast, Toolbar, ToolbarSpacer, ToolbarTitle } from "./ui";

interface Props {
  locations: Location[];
  /** All shots, to show where a location's shots were taken while placing its pin. */
  shots: Shot[];
  onChange: (l: Location[]) => void;
  onShotsChanged: () => void;
  /** Open Shots filtered to this location (grid or map). */
  onShowShots: (locationId: string, layout: "grid" | "map") => void;
}

const sortByName = (list: Location[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

/** Library › Locations: shared by all projects. Inline rename, counts that open Shots, delete with confirm. */
export function LocationsPage({ locations, shots, onChange, onShotsChanged, onShowShots }: Props) {
  const [pinFor, setPinFor] = useState<Location | null>(null);
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(0);
  const [edit, setEdit] = useState<{ id: string; name: string; error: string | null } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const shown = locations.filter((l) => l.name.toLowerCase().includes(q.trim().toLowerCase()));
  const cur = shown[focus];
  useEffect(() => { if (focus >= shown.length) setFocus(Math.max(0, shown.length - 1)); }, [shown.length]);
  useEffect(() => { body.current?.children[focus]?.scrollIntoView({ block: "nearest" }); }, [focus]);

  async function save() {
    if (!edit) return;
    const name = edit.name.trim();
    const old = locations.find((l) => l.id === edit.id);
    if (!name || name === old?.name) { setEdit(null); return; }
    try {
      const saved = await putLocation({ id: edit.id, project_id: old!.project_id, name });
      onChange(sortByName([...locations.filter((l) => l.id !== saved.id), saved]));
      setEdit(null);
      onShotsChanged();
    } catch (err) {
      setEdit({ ...edit, error: err instanceof ApiError && err.status === 409 ? `“${name}” already exists. Names are unique.` : (err as Error).message });
    }
  }
  async function remove(l: Location) {
    const ok = await confirmDialog({ title: `Delete “${l.name}”?`, body: l.shot_count ? `${l.shot_count} shot(s) lose their location. Their photos and tags are kept.` : "No shots use it.", confirmLabel: "Delete location", danger: true });
    if (!ok) return;
    try { await deleteLocation(l.id); onChange(locations.filter((x) => x.id !== l.id)); onShotsChanged(); toast("Location deleted"); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }
  useKeys({
    "/": () => search.current?.focus(),
    j: () => setFocus((f) => Math.min(shown.length - 1, f + 1)), k: () => setFocus((f) => Math.max(0, f - 1)),
    ArrowDown: () => setFocus((f) => Math.min(shown.length - 1, f + 1)), ArrowUp: () => setFocus((f) => Math.max(0, f - 1)),
    F2: () => { if (cur) setEdit({ id: cur.id, name: cur.name, error: null }); },
    p: () => { if (cur) setPinFor(cur); },
    Enter: () => { if (cur) onShowShots(cur.id, "grid"); },
    Delete: () => { if (cur) void remove(cur); },
  }, !edit && !pinFor);

  return (
    <>
      <Toolbar>
        <ToolbarTitle count={locations.length}>Locations</ToolbarTitle>
        <ToolbarSpacer />
        <SearchInput inputRef={search} value={q} placeholder="Filter locations" aria-label="Filter locations" onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }} />
      </Toolbar>
      <div class="f-scroll">
        <table class="f-table">
          <thead><tr><th>Name</th><th>Position</th><th class="is-num">Shots</th><th class="is-num">Approved</th><th style={{ width: "1%" }} /></tr></thead>
          <tbody ref={body}>
            {shown.map((l, i) => {
              const editing = edit?.id === l.id;
              return (
                <tr key={l.id} class={cx(editing && "is-editing", i === focus && !editing && "is-focus")} onClick={() => setFocus(i)}>
                  <td class="is-strong is-wrap">
                    {editing ? (
                      <div class="f-field" style={{ maxWidth: "420px" }}>
                        <Input sm boxClass="is-focus" invalid={!!edit.error} autoFocus value={edit.name} aria-label="Location name" onInput={(e) => setEdit({ ...edit, name: (e.target as HTMLInputElement).value, error: null })}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } if (e.key === "Escape") { e.stopPropagation(); setEdit(null); } }}
                          after={<span style={{ marginRight: "6px" }}><Kbd>↵</Kbd></span>} />
                        {edit.error && <ErrorLine>{edit.error}</ErrorLine>}
                      </div>
                    ) : l.name}
                  </td>
                  <td class="num">{l.lat !== null && l.lon !== null ? <a href="#" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPinFor(l); }}>{l.lat.toFixed(5)}, {l.lon.toFixed(5)}</a> : <span class="is-dim">No pin</span>}{(() => { const n = shots.filter((s) => s.location_id === l.id && s.position_from_location).length; return n ? <span class="meta"> · {n} synced</span> : null; })()}</td>
                  <td class="is-num"><a href="#" onClick={(e) => { e.preventDefault(); onShowShots(l.id, "grid"); }}>{l.shot_count}</a></td>
                  <td class="is-num">{l.approved_count}</td>
                  <td>
                    <div class="btn-row" style={{ gap: "2px", flexWrap: "nowrap" }}>
                      <IconButton icon="pencil-outline" label="Rename (F2)" title="Rename (F2)" onClick={(e) => { e.stopPropagation(); setEdit({ id: l.id, name: l.name, error: null }); }} />
                      <IconButton icon="map-marker-plus-outline" label="Set position (P)" title="Set position (P)" onClick={(e) => { e.stopPropagation(); setPinFor(l); }} />
                      <IconButton icon="map-marker-outline" label="Show on map" title="Show on map" disabled={l.shot_count === 0} onClick={(e) => { e.stopPropagation(); onShowShots(l.id, "map"); }} />
                      <IconButton icon="delete-outline" label="Delete…" title="Delete…" onClick={(e) => { e.stopPropagation(); void remove(l); }} />
                    </div>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={5} class="is-dim">{locations.length ? "No location matches." : "No locations yet. They are created when a shot is tagged, here or on the phone."}</td></tr>}
          </tbody>
        </table>
      </div>
      {pinFor && <PinDialog location={pinFor} shots={shots.filter((s) => s.location_id === pinFor.id)} onClose={() => setPinFor(null)}
        onSaved={(saved) => { onChange(sortByName([...locations.filter((l) => l.id !== saved.id), saved])); onShotsChanged(); setPinFor(null); toast(saved.lat === null ? "Pin removed" : "Position saved"); }} />}
    </>
  );
}

const BERLIN: [number, number] = [52.52, 13.405];

/**
 * Place a location's pin: drag it or click the map. The location's shots are drawn at their own
 * positions (small dots, title on hover) for orientation; shots synced to the location are marked.
 */
function PinDialog({ location, shots, onClose, onSaved }: { location: Location; shots: Shot[]; onClose: () => void; onSaved: (l: Location) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const had = location.lat !== null && location.lon !== null;
  const own = shots.map((s) => ({ s, p: ownPositionOf(s) })).filter((x): x is { s: Shot; p: { lat: number; lon: number } } => !!x.p);
  const centre: [number, number] = had ? [location.lat!, location.lon!] : own.length ? [own.reduce((a, x) => a + x.p.lat, 0) / own.length, own.reduce((a, x) => a + x.p.lon, 0) / own.length] : BERLIN;
  const [pos, setPos] = useState<[number, number]>(centre);
  const [busy, setBusy] = useState(false);
  const synced = shots.filter((s) => s.position_from_location).length;
  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { zoomControl: true }).setView(centre, had || own.length ? 17 : 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
    for (const { s, p } of own) {
      L.circleMarker([p.lat, p.lon], { radius: 6, color: "#0B0B0C", weight: 2, fillColor: s.position_from_location ? "#FFB000" : "#FFFFFF", fillOpacity: 1 })
        .bindTooltip(`${shotTitle(s)}${s.position_from_location ? " · synced to the location" : ""}`).addTo(map);
    }
    const marker = L.marker(centre, { draggable: true, icon: L.divIcon({ className: "f-pin-icon", html: '<span class="f-pin f-pin--drag" title="Drag to place"><i class="mdi mdi-map-marker"></i></span>', iconSize: [40, 40], iconAnchor: [20, 20] }) }).addTo(map);
    marker.on("dragend", () => { const p = marker.getLatLng(); setPos([p.lat, p.lng]); });
    map.on("click", (e: L.LeafletMouseEvent) => { marker.setLatLng(e.latlng); setPos([e.latlng.lat, e.latlng.lng]); });
    if (own.length > 1 && !had) map.fitBounds(L.latLngBounds(own.map((x) => [x.p.lat, x.p.lon] as [number, number])).pad(0.3), { maxZoom: 18 });
    setTimeout(() => map.invalidateSize(), 50);
    return () => { map.remove(); };
  }, []);
  async function save(clear = false) {
    setBusy(true);
    try { onSaved(await putLocation({ id: location.id, project_id: location.project_id, name: location.name, lat: clear ? null : pos[0], lon: clear ? null : pos[1] })); }
    catch (e) { toast(`Saving the position failed: ${(e as Error).message}`, "danger"); setBusy(false); }
  }
  return (
    <Modal title={`Position of ${location.name}`} width="min(960px, 94vw)" onClose={onClose} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div class="f-modal__body" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <span class="meta">Drag the pin or click the map. Dots are this location’s shots at their own positions ({own.length} of {shots.length}; amber = synced to the location). {synced ? `${synced} synced shot${synced === 1 ? "" : "s"} move with the pin.` : ""}</span>
        <div ref={el} class="map" style={{ height: "60vh", borderRadius: "var(--radius-sm)" }} />
        <span class="meta num">{pos[0].toFixed(5)}, {pos[1].toFixed(5)}</span>
      </div>
      <div class="f-modal__foot">
        {had && <Button kind="danger" size="sm" icon="map-marker-remove-outline" disabled={busy} onClick={() => void save(true)}>Remove pin</Button>}
        <span class="f-grow" />
        <Button kind="ghost" kbd="Esc" onClick={onClose}>Cancel</Button>
        <Button icon="map-marker-check-outline" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save position"}</Button>
      </div>
    </Modal>
  );
}
