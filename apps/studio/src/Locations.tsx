import { useEffect, useRef, useState } from "preact/hooks";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ApiError, deleteLocation, deleteSpot, existingIdOf, putLocation, putSpot, type Location, type Shot, type Spot } from "./api";
import { binned } from "./apps/trashOps";
import { ownPositionOf, shotTitle } from "./format";
import { bind, useKeys } from "./keys";
import { Button, confirmDialog, cx, EmptyNote, ErrorLine, IconButton, Input, Kbd, ListRow, Modal, Panel, PanelBody, PanelHead, promptDialog, SearchInput, toast, Toolbar, ToolbarSpacer, ToolbarTitle } from "@openclapper/ui";

interface Props {
  locations: Location[];
  /** All shots, to show where a location's shots were taken while placing its pin. */
  shots: Shot[];
  onChange: (l: Location[]) => void;
  /** Every spot; the page shows the focused location's. */
  spots: Spot[];
  onSpots: (update: (cur: Spot[]) => Spot[]) => void;
  onShotsChanged: () => void;
  /** Open Shots filtered to this location (grid or map). */
  onShowShots: (locationId: string, layout: "grid" | "map") => void;
  /** Focus this location's row (opened from Files or the desktop). */
  focusId?: string | null;
}

const sortByName = (list: Location[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

/** Library › Locations: the project's locations, with the focused one's spots beside them. Inline rename, counts that open Shots, delete with confirm. */
export function LocationsPage({ locations, shots, onChange, spots, onSpots, onShotsChanged, onShowShots, focusId }: Props) {
  const [pinFor, setPinFor] = useState<Location | null>(null);
  const [spotPin, setSpotPin] = useState<Spot | null>(null);
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(0);
  const [edit, setEdit] = useState<{ id: string; name: string; error: string | null } | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const shown = locations.filter((l) => l.name.toLowerCase().includes(q.trim().toLowerCase()));
  const cur = shown[focus];
  useEffect(() => { if (focus >= shown.length) setFocus(Math.max(0, shown.length - 1)); }, [shown.length]);
  useEffect(() => { body.current?.children[focus]?.scrollIntoView({ block: "nearest" }); }, [focus]);
  useEffect(() => { if (!focusId) return; setQ(""); const i = locations.findIndex((l) => l.id === focusId); if (i >= 0) setFocus(i); }, [focusId]);

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
      setEdit({ ...edit, error: err instanceof ApiError && err.status === 409 ? `“${name}” already exists in this project.` : (err as Error).message });
    }
  }
  async function remove(l: Location) {
    try { await deleteLocation(l.id); onChange(locations.filter((x) => x.id !== l.id)); onShotsChanged(); binned([{ type: "location", id: l.id }], l.project_id, `“${l.name}”`); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }
  useKeys(bind("locations", {
    search: () => search.current?.focus(),
    down: () => setFocus((f) => Math.min(shown.length - 1, f + 1)),
    up: () => setFocus((f) => Math.max(0, f - 1)),
    rename: () => { if (cur) setEdit({ id: cur.id, name: cur.name, error: null }); },
    pin: () => { if (cur) setPinFor(cur); },
    open: () => { if (cur) onShowShots(cur.id, "grid"); },
    remove: () => { if (cur) void remove(cur); },
  }), !edit && !pinFor && !spotPin);

  return (
    <>
      <Toolbar>
        <ToolbarTitle count={locations.length}>Locations</ToolbarTitle>
        <ToolbarSpacer />
        <SearchInput inputRef={search} value={q} placeholder="Filter locations" aria-label="Filter locations" onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLInputElement).blur(); }} />
      </Toolbar>
      <div class="f-app__body">
      <div class="f-scroll" style={{ flex: 1 }}>
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
      {cur && <SpotsPanel location={cur} spots={spots.filter((sp) => sp.location_id === cur.id)} onSpots={onSpots} onPin={setSpotPin} onShotsChanged={onShotsChanged} />}
      </div>
      {pinFor && <PinDialog title={`Position of ${pinFor.name}`} place={pinFor} shots={shots.filter((s) => s.location_id === pinFor.id)} onClose={() => setPinFor(null)}
        onSave={async (lat, lon) => {
          const saved = await putLocation({ id: pinFor.id, project_id: pinFor.project_id, name: pinFor.name, lat, lon });
          onChange(sortByName([...locations.filter((l) => l.id !== saved.id), saved])); onShotsChanged(); setPinFor(null); toast(saved.lat === null ? "Pin removed" : "Position saved");
        }} />}
      {spotPin && <PinDialog title={`Position of ${spotPin.name}`} place={spotStart(spotPin, locations)} shots={shots.filter((s) => s.spot_id === spotPin.id)} onClose={() => setSpotPin(null)}
        onSave={async (lat, lon) => {
          const saved = await putSpot({ id: spotPin.id, location_id: spotPin.location_id, name: spotPin.name, lat, lon });
          onSpots((list) => list.map((x) => (x.id === saved.id ? saved : x))); onShotsChanged(); setSpotPin(null); toast(saved.lat === null ? "Pin removed" : "Position saved");
        }} />}
    </>
  );
}

const BERLIN: [number, number] = [52.52, 13.405];

/** A spot without a pin of its own starts at its location's. */
function spotStart(spot: Spot, locations: Location[]): { lat: number | null; lon: number | null; start?: boolean } {
  const l = locations.find((x) => x.id === spot.location_id);
  return spot.lat === null && l && l.lat !== null ? { lat: l.lat, lon: l.lon, start: true } : spot;
}

/** The focused location's spots (issue #44): add, rename, pin, delete. */
function SpotsPanel({ location, spots, onSpots, onPin, onShotsChanged }: { location: Location; spots: Spot[]; onSpots: (update: (cur: Spot[]) => Spot[]) => void; onPin: (s: Spot) => void; onShotsChanged: () => void }) {
  const sorted = [...spots].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  async function name(spot: Spot | null) {
    const n = await promptDialog({ title: spot ? "Rename spot" : `New spot in ${location.name}`, input: { label: "Name", value: spot?.name ?? "", placeholder: "e.g. North gate" }, confirmLabel: spot ? "Rename" : "Add spot" });
    if (!n || n === spot?.name) return;
    try {
      const saved = await putSpot({ id: spot?.id ?? crypto.randomUUID(), location_id: location.id, name: n });
      onSpots((list) => [...list.filter((x) => x.id !== saved.id), saved]);
      if (spot) onShotsChanged();
    } catch (e) { toast(existingIdOf(e) ? `“${n}” already exists in ${location.name}.` : (e as Error).message, "danger"); }
  }
  async function remove(spot: Spot) {
    const ok = await confirmDialog({ title: `Delete “${spot.name}”?`, body: spot.shot_count ? `${spot.shot_count} shot(s) lose their spot and keep the location.` : "No shots use it.", confirmLabel: "Delete spot", danger: true });
    if (!ok) return;
    try { await deleteSpot(spot.id); onSpots((list) => list.filter((x) => x.id !== spot.id)); onShotsChanged(); toast("Spot deleted"); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }
  return (
    <Panel width="320px">
      <PanelHead title={`Spots · ${location.name}`} titleStyle={{ fontSize: "var(--text-body)" }}><Button size="sm" kind="secondary" icon="plus" onClick={() => void name(null)}>Add spot</Button></PanelHead>
      <PanelBody flush>
        {sorted.length === 0 && <EmptyNote>No spots yet. A spot is a place within the location (the north gate, the roof); shots pick one in the tag editor.</EmptyNote>}
        {sorted.map((sp) => (
          <ListRow key={sp.id} as="div" style={{ cursor: "default" }} title={sp.name}
            meta={`${sp.lat !== null && sp.lon !== null ? `${sp.lat.toFixed(5)}, ${sp.lon.toFixed(5)}` : "No pin"} · ${sp.shot_count} shot${sp.shot_count === 1 ? "" : "s"}`}
            trailing={<div class="btn-row" style={{ gap: "2px", flexWrap: "nowrap" }}>
              <IconButton icon="pencil-outline" label="Rename" title="Rename" onClick={() => void name(sp)} />
              <IconButton icon="map-marker-plus-outline" label="Set position" title="Set position" onClick={() => onPin(sp)} />
              <IconButton icon="delete-outline" label="Delete…" title="Delete…" onClick={() => void remove(sp)} />
            </div>} />
        ))}
      </PanelBody>
    </Panel>
  );
}

/**
 * Place a location's or a spot's pin: drag it or click the map. Its shots are drawn at their own
 * positions (small dots, title on hover) for orientation; shots synced to the place are marked.
 * `place.start`: the pin only starts there (a spot without a pin of its own).
 */
function PinDialog({ title, place, shots, onClose, onSave }: { title: string; place: { lat: number | null; lon: number | null; start?: boolean }; shots: Shot[]; onClose: () => void; onSave: (lat: number | null, lon: number | null) => Promise<void> }) {
  const el = useRef<HTMLDivElement>(null);
  const at = place.lat !== null && place.lon !== null;
  const had = at && !place.start;
  const own = shots.map((s) => ({ s, p: ownPositionOf(s) })).filter((x): x is { s: Shot; p: { lat: number; lon: number } } => !!x.p);
  const centre: [number, number] = at ? [place.lat!, place.lon!] : own.length ? [own.reduce((a, x) => a + x.p.lat, 0) / own.length, own.reduce((a, x) => a + x.p.lon, 0) / own.length] : BERLIN;
  const [pos, setPos] = useState<[number, number]>(centre);
  const [busy, setBusy] = useState(false);
  const synced = shots.filter((s) => s.position_from_location).length;
  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { zoomControl: true }).setView(centre, at || own.length ? 17 : 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
    for (const { s, p } of own) {
      L.circleMarker([p.lat, p.lon], { radius: 6, color: "#0B0B0C", weight: 2, fillColor: s.position_from_location ? "#FFB000" : "#FFFFFF", fillOpacity: 1 })
        .bindTooltip(`${shotTitle(s)}${s.position_from_location ? " · synced to the place" : ""}`).addTo(map);
    }
    const marker = L.marker(centre, { draggable: true, icon: L.divIcon({ className: "f-pin-icon", html: '<span class="f-pin f-pin--drag" title="Drag to place"><i class="mdi mdi-map-marker"></i></span>', iconSize: [40, 40], iconAnchor: [20, 20] }) }).addTo(map);
    marker.on("dragend", () => { const p = marker.getLatLng(); setPos([p.lat, p.lng]); });
    map.on("click", (e: L.LeafletMouseEvent) => { marker.setLatLng(e.latlng); setPos([e.latlng.lat, e.latlng.lng]); });
    if (own.length > 1 && !at) map.fitBounds(L.latLngBounds(own.map((x) => [x.p.lat, x.p.lon] as [number, number])).pad(0.3), { maxZoom: 18 });
    setTimeout(() => map.invalidateSize(), 50);
    return () => { map.remove(); };
  }, []);
  async function save(clear = false) {
    setBusy(true);
    try { await onSave(clear ? null : pos[0], clear ? null : pos[1]); }
    catch (e) { toast(`Saving the position failed: ${(e as Error).message}`, "danger"); setBusy(false); }
  }
  return (
    <Modal title={title} width="min(960px, 94vw)" onClose={onClose} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div class="f-modal__body" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <span class="meta">Drag the pin or click the map. Dots are its shots at their own positions ({own.length} of {shots.length}; amber = synced to the place). {synced ? `${synced} synced shot${synced === 1 ? "" : "s"} move with the pin.` : ""}</span>
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
