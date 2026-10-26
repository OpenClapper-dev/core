import { useId } from "react";
import { View } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import type { Vignette as VignetteSpec } from "@openclapper/vocab";
import type { Rect as Box } from "../framing";

/**
 * Lens vignetting over a frame rect (issue #266, vocab vignetting.ts): a radial falloff whose radius
 * is the rect's half-diagonal (userSpaceOnUse keeps it a circle, so the corners darken and the
 * edges' midpoints do not), transparent until `start`, the corner's opacity from `end`. SVG because
 * React Native has no gradients of its own; drawn under the frame lines, never into the photo.
 */
export function Vignette({ rect, v }: { rect: Box; v: VignetteSpec }) {
  const id = `vig${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
  const r = Math.hypot(w, h) / 2;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: rect.left, top: rect.top, width: w, height: h }}>
      <Svg width={w} height={h}>
        <Defs>
          <RadialGradient id={id} cx={w / 2} cy={h / 2} r={r} gradientUnits="userSpaceOnUse">
            <Stop offset={v.start} stopColor="#000" stopOpacity={0} />
            <Stop offset={v.end} stopColor="#000" stopOpacity={v.opacity} />
            <Stop offset={1} stopColor="#000" stopOpacity={v.opacity} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
