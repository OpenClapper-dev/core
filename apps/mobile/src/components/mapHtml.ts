/**
 * Leaflet + OpenStreetMap pages for the WebViews (Shots map, focused map, Correct position): the
 * design system's map pins and, under `html.dark`, the Set theme's tile filter. Pins keep fixed
 * colours because they sit on map tiles; markers are not filtered. Map controls are native
 * buttons; they call the page's functions through injectJavaScript.
 */
export const MAP_CSS = `
.pin-icon{background:none;border:0}
.pin{position:relative;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;box-shadow:0 0 0 2px #fff,0 0 0 3.5px #000,0 2px 6px rgba(0,0,0,.4)}
.pin--unreviewed{background:#FFB000;color:#0B0B0C}
.pin--approved{background:#0F8A43;color:#fff}
.pin--archived{background:#6E6E76;color:#fff}
.pin--sel{transform:scale(1.25);box-shadow:0 0 0 3px #fff,0 0 0 6px #0040D8,0 4px 10px rgba(0,0,0,.5)}
.pin--drag{width:44px;height:44px;background:#fff;color:#0B0B0C;font-size:28px;box-shadow:0 0 0 3px #0B0B0C,0 0 0 5px #fff,0 6px 14px rgba(0,0,0,.45)}
.pin-label{position:absolute;top:36px;left:50%;transform:translateX(-50%);white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis;padding:4px 8px;border-radius:4px;background:#0B0B0C;color:#fff;font:700 13px/1.2 system-ui,Roboto,sans-serif}
html.dark .leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.82) contrast(.92) saturate(.6)}
.leaflet-container{font-family:system-ui,Roboto,sans-serif}
.leaflet-control-attribution{font-size:10px}
`;

export function mapPage({ dark, bg, script }: { dark: boolean; bg: string; script: string }): string {
  return `<!doctype html><html${dark ? ' class="dark"' : ""}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#m{margin:0;height:100%;background:${bg}}${MAP_CSS}</style>
</head><body><div id="m"></div><script>
function post(m){window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m));}
var map=L.map('m',{zoomControl:false});
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap',referrerPolicy:'strict-origin-when-cross-origin'}).addTo(map);
function zoomIn(){map.zoomIn();} function zoomOut(){map.zoomOut();}
${script}
</script></body></html>`;
}

export interface MapPin { id: string; lat: number; lon: number; state: string; icon: string }

const esc = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** All shots as state pins; a tap posts {pin: id} and rings the pin; fitAll() shows every pin. */
export function shotsScript(pins: MapPin[], focus: string | null): string {
  return `var shots=${esc(pins)}, focus=${esc(focus)}, marks={}, sel=null, b=[];
function icon(s,on){return L.divIcon({className:'pin-icon',html:'<span class="pin pin--'+s.state+(on?' pin--sel':'')+'"><i class="mdi mdi-'+s.icon+'"></i></span>',iconSize:[44,52],iconAnchor:[22,26]});}
function select(id){if(sel&&marks[sel])marks[sel].m.setIcon(icon(marks[sel].s,false));sel=id;if(id&&marks[id]){marks[id].m.setIcon(icon(marks[id].s,true));marks[id].m.setZIndexOffset(1000);}}
function fitAll(){if(b.length>1)map.fitBounds(b,{padding:[40,40]});else if(b.length===1)map.setView(b[0],16);}
shots.forEach(function(s){b.push([s.lat,s.lon]);var m=L.marker([s.lat,s.lon],{icon:icon(s,false)}).addTo(map);marks[s.id]={m:m,s:s};
  m.on('click',function(){select(s.id);post({pin:s.id});});});
map.on('click',function(){select(null);post({pin:null});});
if(focus&&marks[focus]){var f=marks[focus].s;map.setView([f.lat,f.lon],16);select(focus);post({pin:focus});}
else if(b.length){fitAll();}else{map.setView([51,10],5);}`;
}

/** One shot, centred at zoom 16 with a labelled pin. */
export function focusScript(pin: MapPin, title: string): string {
  return `var s=${esc(pin)}, t=${esc(title)};
var el='<span class="pin pin--'+s.state+' pin--sel"><i class="mdi mdi-'+s.icon+'"></i></span><span class="pin-label"></span>';
var m=L.marker([s.lat,s.lon],{icon:L.divIcon({className:'pin-icon',html:el,iconSize:[44,52],iconAnchor:[22,26]})}).addTo(map);
m.getElement().querySelector('.pin-label').textContent=t;
map.setView([s.lat,s.lon],16);
function fitAll(){map.setView([s.lat,s.lon],16);}`;
}

/** A draggable pin at zoom 18 with the reported accuracy as a dashed circle; posts {lat, lon} on every move. */
export function positionScript(lat: number, lon: number, accuracyM: number | null, accent: string): string {
  return `map.setView([${lat},${lon}],18);
${accuracyM ? `L.circle([${lat},${lon}],{radius:${accuracyM},color:${esc(accent)},weight:2,dashArray:'6 4',fillColor:${esc(accent)},fillOpacity:.12}).addTo(map);` : ""}
var mk=L.marker([${lat},${lon}],{draggable:true,icon:L.divIcon({className:'pin-icon',html:'<span class="pin pin--drag"><i class="mdi mdi-crosshairs"></i></span>',iconSize:[48,48],iconAnchor:[24,24]})}).addTo(map);
function send(p){post({lat:p.lat,lon:p.lng});}
mk.on('drag',function(){send(mk.getLatLng());});
mk.on('dragend',function(){send(mk.getLatLng());});
map.on('click',function(e){mk.setLatLng(e.latlng);send(e.latlng);});
function fitAll(){map.setView(mk.getLatLng(),18);}`;
}
