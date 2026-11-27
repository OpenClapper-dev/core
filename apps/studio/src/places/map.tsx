// Maps (docs/features/shots.md, "Places"): Leaflet with OpenStreetMap's tiles. The browser's map view shows the
// files that carry a position; the pin editor sets one. Nothing is looked up: an address is never sent anywhere.
import "leaflet/dist/leaflet.css";
import "./places.css";
import L from "leaflet";
import { useEffect, useRef } from "preact/hooks";
import { Button, Dialog, cx } from "@openclapper/design";
import type { FileRec } from "../api";
import { kindOf } from "../fileKinds";
import type { Definition } from "../props";

export interface LatLng { lat: number; lng: number }
const START: LatLng = { lat: 51, lng: 10 };

/**
 * OpenStreetMap's tiles with what its usage policy asks of a web page: attribution, and a Referer. The
 * page's own policy is same-origin, which sends none and gets the tiles refused; the tiles send the origin.
 */
const osmTiles = () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
  referrerPolicy: "strict-origin-when-cross-origin",
});

const isPos = (v: unknown): v is LatLng => !!v && typeof v === "object" && typeof (v as LatLng).lat === "number" && typeof (v as LatLng).lng === "number";
/** A file's position: the value of its first position property that has one. */
export function positionOf(f: FileRec, defs: readonly Definition[]): LatLng | null {
  for (const d of defs) if (d.def.field === "position") { const v = f.values?.[d.id]; if (isPos(v)) return v; }
  return null;
}

const pinIcon = (color: number, on: boolean) => L.divIcon({ className: "", html: `<span class="pl-pin${on ? " is-on" : ""}" style="--c: var(--cat-${color}, var(--accent))"></span>`, iconSize: [22, 30], iconAnchor: [11, 30], popupAnchor: [0, -28] });

/**
 * The browser's map view: one pin per file with a position; a click makes it current, the popup opens it.
 * A project starts without a position property (#426), so the map offers to add one.
 */
export function MapView({ items, defs, current, onCurrent, onOpen, onAddPosition }: { items: readonly FileRec[]; defs: readonly Definition[]; current: string | null; onCurrent: (id: string) => void; onOpen: (f: FileRec) => void; onAddPosition?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const placed = items.map((f) => ({ f, p: positionOf(f, defs) })).filter((x): x is { f: FileRec; p: LatLng } => !!x.p);
  useEffect(() => {
    const m = L.map(box.current!, { zoomControl: true, attributionControl: true }).setView([START.lat, START.lng], 5);
    osmTiles().addTo(m);
    map.current = m; layer.current = L.layerGroup().addTo(m);
    // The map is sized by its window: tell Leaflet when that changes.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current!);
    return () => { ro.disconnect(); m.remove(); };
  }, []);
  useEffect(() => {
    const m = map.current, g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    for (const { f, p } of placed) {
      const pop = document.createElement("div");
      pop.className = "pl-pop";
      pop.innerHTML = `<strong></strong><small></small>`;
      pop.querySelector("strong")!.textContent = f.name;
      pop.querySelector("small")!.textContent = `${kindOf(f.type).label} · ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
      const open = document.createElement("button");
      open.type = "button"; open.className = "oc-btn oc-btn--sm"; open.textContent = "Open";
      open.onclick = () => onOpen(f);
      pop.appendChild(open);
      L.marker([p.lat, p.lng], { icon: pinIcon(kindOf(f.type).color, f.id === current), title: f.name }).addTo(g).bindPopup(pop).on("click", () => onCurrent(f.id));
    }
    if (!fitted.current && placed.length) {
      fitted.current = true;
      m.fitBounds(L.latLngBounds(placed.map(({ p }) => [p.lat, p.lng] as [number, number])).pad(0.2), { maxZoom: 15 });
    }
  }, [items, defs, current]);
  const none = items.length - placed.length;
  return (
    <div className="pl-view">
      <div ref={box} className="pl-map" />
      {onAddPosition && !defs.some((d) => d.def.field === "position")
        ? <div className="pl-note pl-note--add"><span>Nothing here has a position yet: locations need a Position property to be pinned.</span><Button size="sm" variant="primary" icon="plus" onClick={onAddPosition}>Add a Position property</Button></div>
        : none > 0 && <span className="pl-note">{none} of {items.length} without a position</span>}
    </div>
  );
}

/** The pin editor: click to place the pin, drag it to move it; Enter keeps it. */
export function PinDialog({ title, value, near, onSave, onClose }: { title: string; value: LatLng | null; near?: LatLng | null; onSave: (p: LatLng | null) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const at = useRef<LatLng | null>(value);
  const shown = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const start = value ?? near ?? START;
    const m = L.map(box.current!).setView([start.lat, start.lng], value ? 17 : near ? 14 : 5);
    osmTiles().addTo(m);
    let pin: L.Marker | null = null;
    const show = () => { if (shown.current) shown.current.textContent = at.current ? `${at.current.lat.toFixed(6)}, ${at.current.lng.toFixed(6)}` : "No pin yet: click on the map"; };
    const put = (p: LatLng) => {
      at.current = { lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 };
      if (!pin) { pin = L.marker([p.lat, p.lng], { draggable: true, icon: pinIcon(3, true) }).addTo(m); pin.on("dragend", () => put(pin!.getLatLng())); }
      else pin.setLatLng([p.lat, p.lng]);
      show();
    };
    if (value) put(value); else show();
    m.on("click", (e: L.LeafletMouseEvent) => put(e.latlng));
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current!);
    return () => { ro.disconnect(); m.remove(); };
  }, []);
  return (
    <Dialog fixed className="pl-dialog" title={title} onClose={onClose}
      footer={<><span ref={shown} className={cx("pl-coords", "oc-num")} /><span style={{ flex: 1 }} />{value && <Button variant="quiet" onClick={() => onSave(null)}>Remove the pin</Button>}<Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => onSave(at.current)}>Keep</Button></>}>
      <div ref={box} className="pl-map pl-map--edit" onKeyDown={(e) => { if (e.key === "Enter") onSave(at.current); }} />
    </Dialog>
  );
}
