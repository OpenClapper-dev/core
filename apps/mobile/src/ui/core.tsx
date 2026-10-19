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

/** Material Design Icons, same names as the Studio (shared ones are in @fielder/vocab). */
export function Icon({ name, size = SIZE.icon, color }: { name: string; size?: number; color?: string }) {
  const { c } = useTheme();
  return <MaterialCommunityIcons name={name as ComponentProps<typeof MaterialCommunityIcons>["name"]} size={size} color={color ?? c.text} />;
}

/** Rectangles of the Fielder mark on a 72-unit grid (same geometry as the app icon). */
const MARK_CORNERS = [
  [0, 0, 20, 12], [0, 12, 12, 8], [52, 0, 20, 12], [60, 12, 12, 8],
  [52, 60, 20, 12], [60, 52, 12, 8], [0, 60, 20, 12], [0, 52, 12, 8],
];

/** The Fielder mark: viewfinder corners in the text colour around the cinema frame in the accent. */
export function Mark({ size = 28 }: { size?: number }) {
  const { c } = useTheme();
  const k = size / 72;
  const box = (x: number, y: number, w: number, h: number, color: string, key: number) =>
    <View key={key} style={{ position: "absolute", left: x * k, top: y * k, width: w * k, height: h * k, backgroundColor: color }} />;
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {MARK_CORNERS.map(([x, y, w, h], i) => box(x, y, w, h, c.text, i))}
      {box(18, 26, 36, 20, c.accent, 99)}
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
