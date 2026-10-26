import { Image, StyleSheet, type ImageStyle, type StyleProp } from "react-native";

const TILE = require("../../assets/hatch.png");

/**
 * Diagonal hatch for the part of a rig frame the phone could not see (issue #266): black would
 * look like the stage, so the gap gets a pattern that reads the same in both themes and in
 * thumbnails. A repeated 16 px tile (react-native Image supports `repeat`, expo-image does not);
 * its colours are FIXED.beyond / beyondLine. Drawn under the photo, so it never catches touches.
 */
export function Hatch({ style }: { style?: StyleProp<ImageStyle> }) {
  return <Image source={TILE} resizeMode="repeat" style={[StyleSheet.absoluteFill, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
