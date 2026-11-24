import { useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { WebView } from "react-native-webview";
import { catColor, FIXED, useTheme } from "../ui";

/**
 * Locations on a map on the phone (docs/features/shots.md, "Places"): Leaflet 1.9.4 and OpenStreetMap's
 * tiles in a web view, as the first app did; it needs a connection. A tap on a pin opens that location.
 * Pins keep the fixed overlay colours: they sit on map tiles in either theme.
 */
export interface MapPin { id: string; name: string; lat: number; lng: number }

const esc = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

export function MapWeb({ pins, onPick }: { pins: readonly MapPin[]; onPick: (id: string) => void }) {
  const { c, name } = useTheme();
  const dark = name === "dark";
  const html = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#m{margin:0;height:100%;background:${c.bg}}
.pin{width:22px;height:22px;border-radius:50%;background:${catColor(c, 3)};box-shadow:0 0 0 2px ${FIXED.white},0 0 0 3.5px ${FIXED.black},0 2px 6px rgba(0,0,0,.4)}
.lbl{position:absolute;top:26px;left:50%;transform:translateX(-50%);white-space:nowrap;padding:3px 7px;border-radius:4px;background:${FIXED.black};color:${FIXED.white};font:600 13px/1.2 system-ui,Roboto,sans-serif}
${dark ? ".leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) saturate(.6)}" : ""}
.leaflet-control-attribution{font-size:10px}</style></head><body><div id="m"></div><script>
var map=L.map('m');
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap',referrerPolicy:'strict-origin-when-cross-origin'}).addTo(map);
var pins=${esc(pins)};
var b=[];
function h(t){return String(t).replace(/[&<>"]/g,function(x){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x];});}
pins.forEach(function(p){
  var m=L.marker([p.lat,p.lng],{icon:L.divIcon({className:"",html:'<div class="pin"></div><div class="lbl">'+h(p.name)+'</div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(map);
  m.on("click",function(){window.ReactNativeWebView.postMessage(p.id);});
  b.push([p.lat,p.lng]);
});
if(b.length)map.fitBounds(b,{padding:[48,48],maxZoom:15});else map.setView([51,10],5);
</script></body></html>`, [pins, dark]);
  return (
    <View style={{ flex: 1 }}>
      <WebView originWhitelist={["*"]} source={{ html }} style={{ flex: 1, backgroundColor: c.bg }} setSupportMultipleWindows={false}
        startInLoadingState renderLoading={() => <ActivityIndicator style={{ marginTop: 32 }} />} onMessage={(e) => onPick(e.nativeEvent.data)} />
    </View>
  );
}
