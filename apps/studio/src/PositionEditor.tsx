import { useEffect, useRef, useState } from "preact/hooks";
import L from "leaflet";
import { osmTiles } from "./mapTiles";
import "leaflet/dist/leaflet.css";
import { patchPhotoPosition, type Photo, type Shot } from "./api";
import { positionOf } from "./format";
import { bind, useKeys } from "./keys";
import { Button, Checkbox, Icon, Spinner, ToolbarSpacer } from "@openclapper/ui";

interface Props { shot: Shot; photo: Photo; onSaved: (s: Shot) => void; onCancel: () => void; onError: (msg: string) => void }

/** Great-circle distance in metres (for "moved 14 m"). */
function metres(a: [number, number], b: [number, number]): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Where the map opens for a photo without a position: another photo of the shot, else Berlin. */
const BERLIN: [number, number] = [52.52, 13.405];

/** Stage mode "Position": drag the pin (or click the map) to where the photo was really taken, or set one for a photo captured without GPS. */
export function PositionStage({ shot, photo, onSaved, onCancel, onError }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const had = photo.lat !== null && photo.lon !== null;
  const start: [number, number] = had ? [photo.lat!, photo.lon!] : (() => { const p = positionOf(shot); return p ? [p.lat, p.lon] : BERLIN; })();
  const [pos, setPos] = useState<[number, number]>(start);
  const [all, setAll] = useState(shot.photos.length > 1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { zoomControl: false }).setView(start, had || positionOf(shot) ? 18 : 12);
    osmTiles().addTo(map);
    L.control.zoom({ position: "topleft" }).addTo(map);
    // Reported accuracy: dashed ring with a faint accent fill, readable on light and (filtered) dark tiles.
    if (had && photo.gps_accuracy_m) L.circle(start, { radius: photo.gps_accuracy_m, color: "#0B0B0C", weight: 2, dashArray: "6 4", fillColor: "#0040D8", fillOpacity: 0.12 }).addTo(map);
    if (had) L.marker(start, { icon: L.divIcon({ className: "f-pin-icon", html: '<span class="f-pin__origin" style="position:static;transform:none;display:block"></span>', iconSize: [12, 12], iconAnchor: [6, 6] }), interactive: false }).addTo(map);
    const marker = L.marker(start, {
      draggable: true,
      icon: L.divIcon({ className: "f-pin-icon", html: '<span class="f-pin f-pin--drag" title="Drag to correct"><i class="mdi mdi-crosshairs-gps"></i></span>', iconSize: [40, 40], iconAnchor: [20, 20] }),
    }).addTo(map);
    marker.on("dragend", () => { const p = marker.getLatLng(); setPos([p.lat, p.lng]); });
    map.on("click", (e: L.LeafletMouseEvent) => { marker.setLatLng(e.latlng); setPos([e.latlng.lat, e.latlng.lng]); });
    return () => { map.remove(); };
  }, [photo.id]);

  const moved = metres(start, pos);
  // Without a position yet, the starting point itself is a valid choice.
  const changed = !had || moved > 0.05;
  async function save() {
    if (!changed || busy) return;
    setBusy(true);
    try { onSaved(await patchPhotoPosition(photo.id, pos[0], pos[1], all)); } catch (e) { onError(`Saving the position failed: ${(e as Error).message}`); } finally { setBusy(false); }
  }
  useKeys(bind("position", { cancel: onCancel, save: () => void save() }));

  return (
    <>
      <div class="f-stage__bar">
        <Icon name="cursor-move" size={18} /><span style={{ fontSize: "var(--text-small)" }}>{had ? "Drag the pin or click the map" : "No GPS position: put the pin where the photo was taken"}</span>
        <span class="meta num">{pos[0].toFixed(5)}, {pos[1].toFixed(5)}{had && moved > 0.05 ? ` · moved ${Math.round(moved)} m` : ""}</span>
        <ToolbarSpacer />
        {shot.photos.length > 1 && (
          <Checkbox checked={all} role="checkbox" aria-checked={all} onClick={() => setAll(!all)}>
            All {shot.photos.length} photos of this shot
          </Checkbox>
        )}
        <Button kind="ghost" size="sm" kbd="Esc" onClick={onCancel}>Cancel</Button>
        <Button size="sm" kbd="↵" disabled={!changed || busy} onClick={() => void save()}>{busy && <Spinner style={{ width: "14px", height: "14px", borderWidth: "2px", borderTopColor: "currentColor" }} />}{busy ? "Saving…" : "Save position"}</Button>
      </div>
      <div class="f-stage__view" style={{ padding: 0 }}>
        <div ref={el} class="map" />
        {photo.gps_accuracy_m != null && <span class="f-framed__tag" style={{ left: "12px", bottom: "28px", zIndex: 500 }}>Reported ±{Math.round(photo.gps_accuracy_m)} m · zoom 18</span>}
      </div>
    </>
  );
}
