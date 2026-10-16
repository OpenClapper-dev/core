import { StyleSheet, Text, View } from "react-native";
import type { Box, Rect } from "../framing";
import { BORDER, FIXED, FONT } from "../ui";
import type { ViewSettings } from "../types";

interface Props {
  preview: Box;
  rect: Rect;
  settings: ViewSettings;
  exceedsPreview: boolean;
  /** Optional human-view reference frame (thin cyan line, no blackout). */
  human?: { rect: Rect; fits: boolean; focalMm?: number } | null;
  /** Stored photos: neutral mask and white frame regardless of the live-view settings (photos never take a colour). */
  neutral?: boolean;
}

export const HUMAN_COLOR = FIXED.human;

/**
 * Frame rectangle plus optional blackout outside it. Pure layout, no per-frame work.
 * The frame line has a 1 dp black outline on both sides so it reads over sky and shadow alike.
 */
export function Overlay({ preview, rect, settings, exceedsPreview, human, neutral }: Props) {
  const right = preview.width - rect.left - rect.width;
  const bottom = preview.height - rect.top - rect.height;
  const tint = neutral ? FIXED.mask : settings.blackoutColor;
  const borderColor = neutral ? FIXED.frameLine : settings.borderColor;
  const bw = neutral ? 2 : settings.borderWidthPx;
  // dashed = the frame extends beyond what the phone can see
  const style = exceedsPreview ? "dashed" : "solid";
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width: preview.width, height: preview.height }]}>
      {settings.blackoutEnabled && (
        <>
          <View style={{ position: "absolute", left: 0, top: 0, right: 0, height: rect.top, backgroundColor: tint }} />
          <View style={{ position: "absolute", left: 0, bottom: 0, right: 0, height: bottom, backgroundColor: tint }} />
          <View style={{ position: "absolute", left: 0, top: rect.top, width: rect.left, height: rect.height, backgroundColor: tint }} />
          <View style={{ position: "absolute", right: 0, top: rect.top, width: right, height: rect.height, backgroundColor: tint }} />
        </>
      )}
      <View style={{ position: "absolute", left: rect.left - 1, top: rect.top - 1, width: rect.width + 2, height: rect.height + 2, borderWidth: 1, borderColor: FIXED.frameOutline, borderStyle: style }} />
      <View style={{ position: "absolute", left: rect.left, top: rect.top, width: rect.width, height: rect.height, borderWidth: bw, borderColor, borderStyle: style }} />
      <View style={{ position: "absolute", left: rect.left + bw, top: rect.top + bw, width: Math.max(0, rect.width - 2 * bw), height: Math.max(0, rect.height - 2 * bw), borderWidth: 1, borderColor: FIXED.frameOutline, borderStyle: style }} />
      {human && (
        <View
          style={{
            position: "absolute",
            left: human.rect.left,
            top: human.rect.top,
            width: human.rect.width,
            height: human.rect.height,
            borderWidth: BORDER.badge,
            borderColor: HUMAN_COLOR,
            borderStyle: human.fits ? "solid" : "dashed",
          }}
        >
          <Text style={s.humanLabel}>HUMAN{human.focalMm ? ` ${human.focalMm}` : ""}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  // Solid black tag: readable over any image.
  humanLabel: { position: "absolute", left: -1.5, top: -1.5, backgroundColor: FIXED.black, color: HUMAN_COLOR, fontFamily: FONT.bold, fontSize: 10, letterSpacing: 0.6, paddingHorizontal: 5, paddingVertical: 3 },
});
