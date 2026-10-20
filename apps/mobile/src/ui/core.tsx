/** Base pieces every other component uses: layout measuring, MDI icons, the mark, labels and hints. */
import { useState, type ComponentProps, type ReactNode } from "react";
import { Text, View, type LayoutChangeEvent } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { SIZE, useTheme } from "./theme";
import { useStyles } from "./styles";

/** Measured size of a view: `const [box, onLayout] = useLayoutSize()`; zero until the first layout. */
export function useLayoutSize(): [{ width: number; height: number }, (e: LayoutChangeEvent) => void] {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (Math.abs(b.width - width) < 0.5 && Math.abs(b.height - height) < 0.5 ? b : { width, height }));
  };
  return [box, onLayout];
}

/** Material Design Icons, same names as the Studio (shared ones are in @openclapper/vocab). */
export function Icon({ name, size = SIZE.icon, color }: { name: string; size?: number; color?: string }) {
  const { c } = useTheme();
  return <MaterialCommunityIcons name={name as ComponentProps<typeof MaterialCommunityIcons>["name"]} size={size} color={color ?? c.text} />;
}

/**
 * The mark on a 72-unit grid (same geometry as the phone app icon): two diagonal slate stripes in
 * the text colour, the phone glyph in the accent in the channel between them. A stripe is the band
 * between the lines x+y=mid∓8: a long rectangle of the band's width rotated 45° around its centre
 * (mid/2, mid/2), clipped by the container. The icon punches the lens out of the glyph; here a dot
 * in the background colour stands in, since Views cannot punch holes.
 */
export function Mark({ size = 28 }: { size?: number }) {
  const { c } = useTheme();
  const k = size / 72;
  const bandW = 16 / Math.SQRT2;
  const stripe = (mid: number, key: number) =>
    <View key={key} style={{ position: "absolute", left: (mid / 2 - 60) * k, top: (mid / 2 - bandW / 2) * k, width: 120 * k, height: bandW * k, transform: [{ rotate: "-45deg" }], backgroundColor: c.text }} />;
  return (
    <View style={{ width: size, height: size, overflow: "hidden" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {stripe(38, 0)}
      {stripe(106, 1)}
      <View style={{ position: "absolute", left: 29 * k, top: 23 * k, width: 14 * k, height: 26 * k, borderRadius: 3 * k, backgroundColor: c.accent }} />
      <View style={{ position: "absolute", left: 33 * k, top: 26.5 * k, width: 6 * k, height: 6 * k, borderRadius: 3 * k, backgroundColor: c.bg }} />
    </View>
  );
}

/** Uppercase section label (13 dp caps). */
export function SectionLabel({ children, color }: { children: ReactNode; color?: string }) {
  const s = useStyles();
  return <Text style={[s.section, color ? { color } : null]}>{children}</Text>;
}

export function Hint({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <Text style={s.hint}>{children}</Text>;
}

/** Overline heading above a group of rows, padded to sit between full-width rows (16 / 20 / 8). */
export function SectionHeading({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <Text style={s.sectionHeading}>{children}</Text>;
}
