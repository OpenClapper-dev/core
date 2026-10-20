import { useMemo, useRef, type ComponentType, type ReactNode, type Ref, type RefObject } from "react";
import { View } from "react-native";
import { WebView as RNWebView, type WebViewMessageEvent, type WebViewProps } from "react-native-webview";
import { useOnline } from "../net";
import { Empty, IconButton, makeStyles, useTheme } from "../ui";
import { mapPage } from "./mapHtml";

// react-native-webview's class typings collapse to `never` under this TS/React combination; use the props type directly.
const WebView = RNWebView as unknown as ComponentType<WebViewProps & { ref?: Ref<{ injectJavaScript: (js: string) => void }> }>;

export interface MapHandle { run: (js: string) => void }

/**
 * A Leaflet map in a WebView with native controls (zoom in, zoom out, show all; 52 dp, right
 * column). Tiles are not cached, so without a connection it shows an explicit empty state.
 */
export function LeafletView({ script, onMessage, fitLabel = "Show all", offlineAction, handle, controls = true }: { script: string; onMessage?: (m: Record<string, unknown>) => void; fitLabel?: string; offlineAction?: ReactNode; handle?: RefObject<MapHandle | null>; controls?: boolean }) {
  const s = useStyles();
  const { c, name } = useTheme();
  const online = useOnline();
  const ref = useRef<{ injectJavaScript: (js: string) => void } | null>(null);
  const source = useMemo(() => ({ html: mapPage({ dark: name === "set", bg: c.bg, script }), baseUrl: "https://openclapper.local/" }), [name, c.bg, script]);
  const run = (js: string) => ref.current?.injectJavaScript(`${js};true;`);
  if (handle) handle.current = { run };
  if (!online) {
    return (
      <View style={[s.root, { justifyContent: "center" }]}>
        <Empty icon="map-marker-off-outline" title="Map needs a connection" body="Map tiles aren't stored on the phone.">{offlineAction}</Empty>
      </View>
    );
  }
  return (
    <View style={s.root}>
      <WebView
        ref={ref}
        originWhitelist={["*"]}
        source={source}
        style={{ flex: 1, backgroundColor: c.bg }}
        onMessage={(e: WebViewMessageEvent) => { try { onMessage?.(JSON.parse(e.nativeEvent.data) as Record<string, unknown>); } catch { /* not ours */ } }}
        javaScriptEnabled
        domStorageEnabled
        setSupportMultipleWindows={false}
      />
      {controls && (
        <View style={s.controls}>
          <IconButton icon="plus" label="Zoom in" size={52} onPress={() => run("zoomIn()")} />
          <IconButton icon="minus" label="Zoom out" size={52} onPress={() => run("zoomOut()")} />
          <IconButton icon="fit-to-page-outline" label={fitLabel} size={52} onPress={() => run("fitAll()")} />
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  controls: { position: "absolute", right: 16, top: 16, gap: 8 },
}));
