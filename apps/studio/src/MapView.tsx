import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { label, STATE_ICONS } from "@openclapper/vocab";
import type { Shot } from "./api";
import { cover, positionOf, seqCount, shotTitle } from "./format";
import { Framed, FramedThumb, type MaskMode } from "./Framed";
import { shotSub } from "./ShotCard";
import { Button, cx, SeqBadge, StateMarker } from "@openclapper/ui";

interface Props {
  shots: Shot[];
  mask: MaskMode;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpen: (s: Shot) => void;
}

const pinIcon = (s: Shot, selected: boolean) => L.divIcon({
  className: "f-pin-icon",
  html: `<span class="f-pin f-pin--${s.state}${selected ? " is-selected" : ""}" title="${label(s.state)}"><i class="mdi mdi-${STATE_ICONS[s.state]}"></i></span>`,
  iconSize: selected ? [36, 36] : [26, 26], iconAnchor: selected ? [18, 18] : [13, 13], popupAnchor: [0, -16],
});

/** Shots layout "Map": the result list on the left, one state pin per shot; the popup opens the shot view. */
export function ShotsMap({ shots, mask, selectedId, onSelect, onOpen }: Props) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector(".is-selected")?.scrollIntoView({ block: "nearest" }); }, [selectedId]);
  const idx = shots.findIndex((s) => s.id === selectedId);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = shots[Math.max(0, Math.min(shots.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))]; if (n) onSelect(n.id); }
    else if (e.key === "Enter" && idx >= 0) { e.preventDefault(); onOpen(shots[idx]); }
  };
  return (
    <>
      <div class="f-panel f-panel--left" style={{ "--panel-w": "320px" }}>
        <div ref={list} class="f-panel__body f-panel__body--flush" role="listbox" aria-label="Shots on the map" tabIndex={0} onKeyDown={onKey}>
          {shots.map((s) => (
            <button key={s.id} type="button" role="option" aria-selected={s.id === selectedId} class={cx("f-row f-row--dense", s.id === selectedId && "is-selected")} onClick={() => onSelect(s.id)} onDblClick={() => onOpen(s)}>
              <div class="f-row__thumb" style={{ width: "64px" }}><FramedThumb photo={cover(s)} mode={mask} /></div>
              <div class="f-row__main"><span class="f-row__title">{shotTitle(s)}</span><span class="f-row__meta">{positionOf(s) ? shotSub(s) : "No position · not on the map"}</span></div>
              <StateMarker state={s.state} iconOnly />
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <LeafletMap shots={shots} mask={mask} selectedId={selectedId} onSelect={onSelect} onOpen={onOpen} />
      </div>
    </>
  );
}

function LeafletMap({ shots, mask, selectedId, onSelect, onOpen }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef(new Map<string, L.Marker>());
  const fit = () => {
    const m = map.current;
    const b = shots.map(positionOf).filter((p) => !!p).map((p) => [p!.lat, p!.lon] as L.LatLngTuple);
    if (!m) return;
    if (b.length === 1) m.setView(b[0], 15); else if (b.length > 1) m.fitBounds(b, { padding: [40, 40] }); else m.setView([51, 10], 5);
  };

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
    L.control.zoom({ position: "topleft" }).addTo(m);
    map.current = m;
    m.setView([51, 10], 5);
    // The map lives in a resizable window: Leaflet must re-measure when its box changes.
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    for (const mk of markers.current.values()) mk.remove();
    markers.current.clear();
    for (const s of shots) {
      const p = positionOf(s);
      if (!p) continue; // captured without GPS: listed, but no pin
      const mk = L.marker([p.lat, p.lon], { icon: pinIcon(s, s.id === selectedId), title: shotTitle(s), keyboard: false });
      mk.bindPopup(() => popupContent(s, mask, () => onOpen(s)), { maxWidth: 260, minWidth: 248, className: "f-leaflet-popup" });
      mk.on("click", () => onSelect(s.id));
      mk.addTo(m);
      markers.current.set(s.id, mk);
    }
    fit();
  }, [shots, mask]);

  useEffect(() => {
    for (const [id, mk] of markers.current) {
      const s = shots.find((x) => x.id === id);
      if (s) mk.setIcon(pinIcon(s, id === selectedId));
      if (id === selectedId) mk.setZIndexOffset(1000); else mk.setZIndexOffset(0);
    }
    const mk = selectedId ? markers.current.get(selectedId) : null;
    if (mk && map.current) { map.current.setView(mk.getLatLng(), Math.max(map.current.getZoom(), 15)); mk.openPopup(); }
  }, [selectedId]);

  return (
    <>
      <div ref={el} class="map" />
      <Button kind="secondary" size="sm" class="map-fit" icon="fit-to-page-outline" onClick={fit}>Fit all</Button>
    </>
  );
}

/** Leaflet wants a DOM node for the popup: render the same components the rest of the Studio uses into one. */
function popupContent(s: Shot, mask: MaskMode, open: () => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "map-popup";
  render(<MapPopup shot={s} mask={mask} onOpen={open} />, el);
  return el;
}

function MapPopup({ shot: s, mask, onOpen }: { shot: Shot; mask: MaskMode; onOpen: () => void }) {
  return (
    <>
      <Framed photo={cover(s)} mode={mask}>{seqCount(s) > 1 && <div class="f-card__tl"><SeqBadge count={seqCount(s)} /></div>}</Framed>
      <div class="map-popup__body">
        <div class="map-popup__head"><strong>{shotTitle(s)}</strong><StateMarker state={s.state} /></div>
        <span class="meta">{[shotSub(s), s.project_name].filter(Boolean).join(" · ")}</span>
        <Button size="sm" kbd="↵" onClick={onOpen}>Open details</Button>
      </div>
    </>
  );
}
