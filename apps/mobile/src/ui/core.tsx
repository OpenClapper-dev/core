/** Base pieces every other component uses: layout measuring, MDI icons, the mark, labels and hints. */
import { useState, type ComponentProps, type ReactNode } from "react";
import { Image, Text, type LayoutChangeEvent } from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { SIZE, useTheme } from "./theme";
import { useStyles } from "./styles";

/** Made with the app icons (#249): a white silhouette that Mark tints. */
const MARK = require("../../assets/mark.png");

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
 * The mark (same geometry as the phone app icon, #249): the slate corner with the phone glyph cut
 * out, as a white silhouette (assets/mark.png, made with the icons) tinted with the text colour, so
 * the background shows through the glyph in both themes. An image because Views cannot draw the
 * slanted stripes or punch the glyph out.
 */
export function Mark({ size = 28 }: { size?: number }) {
  const { c } = useTheme();
  return <Image source={MARK} style={{ width: size, height: size, tintColor: c.text }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
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
