/** Base pieces every other component uses: layout measuring, the glyphs, the mark, labels and hints. */
import { useMemo, useState, type ReactNode } from "react";
import { Image, Text, type LayoutChangeEvent } from "react-native";
import { SvgXml } from "react-native-svg";
import { GLYPHS, type IconName } from "@openclapper/design/glyphs";
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

export type { IconName };

/**
 * A glyph of the design system (Tabler outline plus the film glyphs, packages/design glyphs.ts), the
 * same set and names as the Studio. The stroke follows the size as there: about 1.75 at 24 dp.
 */
export function Icon({ name, size = SIZE.icon, color }: { name: IconName; size?: number; color?: string }) {
  const { c } = useTheme();
  const sw = size <= 16 ? 2 : size <= 24 ? 1.75 : 1.5;
  const xml = useMemo(() => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name][1]}</svg>`, [name, sw]);
  return <SvgXml xml={xml} width={size} height={size} color={color ?? c.text} />;
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
