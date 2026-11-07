import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import * as Location from "expo-location";
import { useKeepAwake } from "expo-keep-awake";
import { VideoLinkView, type LinkStatus } from "../../modules/video-link";
import { log } from "../log";
import { Banner, Block, FIXED, Hint, makeStyles, num, PushScreen, SectionLabel, type } from "../ui";

const STATE_WORDS: Record<LinkStatus["state"], string> = {
  idle: "Stopped",
  searching: "Looking for Wi-Fi",
  connecting: "Logging in to the transmitter",
  playing: "Live",
  error: "Retrying",
};

/**
 * Setup → Live picture (#302): the Hollyland Mars 400S Pro's picture, straight from the transmitter's Wi-Fi.
 * A prototype to measure latency against HollyView; the stats line shows what the phone adds.
 */
export function LivePicture() {
  useKeepAwake();
  const s = useStyles();
  const [st, setSt] = useState<LinkStatus>({ state: "idle" });
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  // The login sends the Wi-Fi's name, which Android shows only with the location permission.
  const [ready, setReady] = useState(false);
  useEffect(() => { void Location.requestForegroundPermissionsAsync().finally(() => setReady(true)); }, []);

  const onStatus = (e: { nativeEvent: LinkStatus }) => {
    const n = e.nativeEvent;
    if (n.width && n.height) setSize({ width: n.width, height: n.height });
    setSt((prev) => {
      if (n.state !== prev.state || n.message !== prev.message) log("info", "live picture", { state: n.state, message: n.message, wifiNamed: n.ssid === undefined ? undefined : !!n.ssid });
      return { ...prev, ...n };
    });
  };

  const aspect = size ? size.width / size.height : 16 / 9;
  const stats = st.state === "playing" && st.fps !== undefined
    ? `${st.fps} fps · ${((st.kbps ?? 0) / 1000).toFixed(1)} Mbit/s · decode ${(st.decodeMs ?? 0).toFixed(0)} ms · lost ${st.lost ?? 0} · dropped ${st.dropped ?? 0}`
    : null;

  return (
    <PushScreen title="Live picture" sub="Hollyland Mars 400S Pro">
      <View style={[s.frame, { aspectRatio: aspect }]}>
        {ready && <VideoLinkView style={s.video} active onStatus={onStatus} />}
      </View>
      <Block>
        <SectionLabel>{STATE_WORDS[st.state]}</SectionLabel>
        {stats && <Text style={s.stats}>{stats}</Text>}
        {size && <Text style={s.stats}>{`${size.width} × ${size.height}`}</Text>}
        {st.state === "error" && st.message && <Banner kind="warn" title={st.message} />}
        {st.state === "connecting" && st.ssid === "" && <Banner kind="warn" title="Wi-Fi name hidden" meta="Allow location for OpenClapper; the transmitter's login needs the Wi-Fi name." />}
        <Hint>Join the transmitter's Wi-Fi (HLD_…) in Android's settings and keep mobile data on for the server. Close HollyView first: the transmitter allows only a few viewers.</Hint>
      </Block>
    </PushScreen>
  );
}

const useStyles = makeStyles((c) => ({
  frame: { width: "100%", backgroundColor: FIXED.photoBg },
  video: { flex: 1 },
  stats: { ...type("caption"), color: c.textDim, ...num },
}));
