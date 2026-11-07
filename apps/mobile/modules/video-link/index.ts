import { requireNativeView } from "expo";
import type { ViewProps } from "react-native";

/** Where the link is: looking for the transmitter's Wi-Fi, logging in and starting RTSP, showing the picture, or failed (it retries). */
export type LinkState = "idle" | "searching" | "connecting" | "playing" | "error";

/** One status event from the native view; the counters come once a second while playing. */
export interface LinkStatus {
  state: LinkState;
  message?: string;
  /** The Wi-Fi the phone is on (the login sends it); empty when Android hides it (no location permission). */
  ssid?: string;
  width?: number;
  height?: number;
  /** Frames shown in the last second. */
  fps?: number;
  kbps?: number;
  /** RTP packets lost since the start. */
  lost?: number;
  /** Frames dropped because the decoder had no free input. */
  dropped?: number;
  /** Mean time from a frame's last packet to its display, in ms. */
  decodeMs?: number;
  /** Diagnostics: RTP packets of the video track, NAL units by type ("1:120 7:1 8:1"), and the decoder's state. */
  packets?: number;
  nals?: string;
  decoder?: string;
}

export interface VideoLinkProps extends ViewProps {
  /** The transmitter (Hollyland Mars 400S Pro: 192.168.218.10). */
  host?: string;
  /** Connects while true; the native side retries until it is false or the view unmounts. */
  active: boolean;
  onStatus?: (e: { nativeEvent: LinkStatus }) => void;
}

/**
 * The live picture of a Hollyland Mars transmitter (#302), decoded natively: HCCP login and keep-alive,
 * then RTSP with RTP over UDP into the hardware H.264 decoder, rendered as soon as a frame is out.
 * Android only.
 */
export const VideoLinkView = requireNativeView<VideoLinkProps>("VideoLink");
