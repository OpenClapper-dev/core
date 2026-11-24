import { createContext, useContext, useMemo, type ReactNode } from "react";
import { StyleSheet, useColorScheme, type TextStyle } from "react-native";
import { TOKENS } from "@openclapper/design/tokens";

/**
 * The phone's palette, derived from the design system's tokens (packages/design, one source for the
 * Studio and the phone), under the names the components here use. Light for daylight, Dark for dark
 * sets; the tokens hold the contrast rules (text ≥ 7:1, secondary ≥ 4.5:1, control borders ≥ 3:1).
 */
export interface Palette {
  bg: string; surface: string; surfaceRaised: string; surfaceSunken: string;
  text: string; textDim: string; textDisabled: string;
  border: string; borderStrong: string; borderSubtle: string;
  accent: string; accentPressed: string; onAccent: string; accentTint: string;
  focus: string;
  ok: string; okHover: string; onOk: string; okTint: string;
  danger: string; dangerHover: string; onDanger: string; dangerTint: string;
  warn: string; onWarn: string; warnInk: string; warnTint: string;
  archive: string; archiveHover: string; onArchive: string;
  /** The eight categorical colours (collections), 1-based like the model's colour numbers. */
  cat: readonly string[];
  scrim: string;
}

export type ThemeName = "light" | "dark";
/** "auto" follows the phone's dark-mode setting; the account's preference (prefs.ts) holds the choice. */
export type ThemeChoice = "auto" | ThemeName;

function palette(name: ThemeName): Palette {
  const t = TOKENS[name];
  return {
    bg: t.surfaceSunken, surface: t.surface, surfaceRaised: t.surfaceRaised, surfaceSunken: t.surfacePressed,
    text: t.text, textDim: t.textSecondary, textDisabled: t.textDisabled,
    border: t.borderControl, borderStrong: t.text, borderSubtle: t.borderDivider,
    accent: t.accent, accentPressed: t.accentPressed, onAccent: t.textOnAccent, accentTint: t.accentTint,
    focus: t.focus,
    ok: t.success, okHover: t.success, onOk: t.textInverse, okTint: t.successTint,
    danger: t.danger, dangerHover: t.danger, onDanger: t.textInverse, dangerTint: t.dangerTint,
    warn: t.warning, onWarn: t.textInverse, warnInk: t.warning, warnTint: t.warningTint,
    archive: t.surfaceHover, archiveHover: t.surfacePressed, onArchive: t.text,
    cat: ["", t.cat1, t.cat2, t.cat3, t.cat4, t.cat5, t.cat6, t.cat7, t.cat8],
    scrim: t.scrim,
  };
}
export const PALETTES: Record<ThemeName, Palette> = { light: palette("light"), dark: palette("dark") };

/** A collection's colour: one of the eight categorical ones (1–8), or any colour as #rrggbb. */
export const catColor = (c: Palette, color: number | string | null | undefined): string =>
  typeof color === "string" ? color : c.cat[color ?? 1] ?? c.cat[1];

/** Theme-independent colours: things drawn over photos or the camera image, which never take the theme. */
export const FIXED = {
  photoBg: TOKENS.FIXED.photoBg,
  frameLine: TOKENS.FIXED.overFrame,
  frameOutline: TOKENS.FIXED.overFrameOutline,
  mask: TOKENS.FIXED.overMask,
  human: TOKENS.FIXED.overHuman,
  record: TOKENS.FIXED.overRec,
  white: TOKENS.FIXED.overPaper,
  black: TOKENS.FIXED.overInk,
  /** Controls over the live picture: a dark glass behind white glyphs. */
  glass: "rgba(0,0,0,.55)",
} as const;

/** Atkinson Hyperlegible Next (loaded in App.tsx): open shapes, 1/l/I and 0/O told apart under glare. */
export const FONT = {
  regular: "AtkinsonHyperlegibleNext_400Regular",
  medium: "AtkinsonHyperlegibleNext_500Medium",
  semibold: "AtkinsonHyperlegibleNext_600SemiBold",
  bold: "AtkinsonHyperlegibleNext_700Bold",
  heavy: "AtkinsonHyperlegibleNext_800ExtraBold",
  mono: "monospace",
} as const;
export type Weight = keyof typeof FONT;

const TYPE = {
  caption: { fontSize: 13, lineHeight: 18 },
  small: { fontSize: 15, lineHeight: 20 },
  body: { fontSize: 17, lineHeight: 24 },
  label: { fontSize: 15, lineHeight: 20, letterSpacing: 0.2 },
  overline: { fontSize: 13, lineHeight: 16, letterSpacing: 0.8, textTransform: "uppercase" as const },
  title: { fontSize: 20, lineHeight: 26 },
  heading: { fontSize: 24, lineHeight: 30 },
  display: { fontSize: 32, lineHeight: 38 },
  hud: { fontSize: 15, lineHeight: 18 },
};

/** A type-scale step in one weight. Custom fonts need the family per weight; fontWeight would not pick it. */
export const type = (step: keyof typeof TYPE, weight: Weight = "regular"): TextStyle => ({ ...TYPE[step], fontFamily: FONT[weight] });
export const num: TextStyle = { fontVariant: ["tabular-nums"] };

export const RADIUS = { xs: 3, sm: 8, md: 12, lg: 18, pill: 999 } as const;
/** Spacing scale of the design system (dp), the phone's counterpart of the Studio's --space-*. */
export const SPACE = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
/** header: AppHeader and the full-screen headers; actionColumn: the landscape action bar. */
export const SIZE = { touchMin: 48, control: 52, controlLg: 60, shutter: 76, tabBar: 64, edgePad: 32, iconSm: 20, icon: 24, iconLg: 28, header: 64, actionColumn: 148 } as const;
/** Control borders are 2 dp (never hairlines: they vanish in sunlight). `badge` (1.5 dp) is for tags and chrome over photos only. */
export const BORDER = { control: 2, selected: 3, frame: 2, badge: 1.5 } as const;

interface Theme { name: ThemeName; choice: ThemeChoice; c: Palette }
const ThemeContext = createContext<Theme>({ name: "light", choice: "auto", c: PALETTES.light });

export function resolveTheme(choice: ThemeChoice, os: string | null | undefined): ThemeName {
  return choice === "auto" ? (os === "dark" ? "dark" : "light") : choice;
}

export function ThemeProvider({ choice, children }: { choice: ThemeChoice; children: ReactNode }) {
  const os = useColorScheme();
  const name = resolveTheme(choice, os);
  const value = useMemo(() => ({ name, choice, c: PALETTES[name] }), [name, choice]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): Theme => useContext(ThemeContext);

/**
 * Theme-dependent styles: `const useStyles = makeStyles((c) => ({ ... }))` at module level, then
 * `const s = useStyles()` in the component. Built once per theme.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(factory: (c: Palette, name: ThemeName) => T): () => T {
  const cache = new Map<ThemeName, T>();
  return function useStyles(): T {
    const { name, c } = useTheme();
    let s = cache.get(name);
    if (!s) { s = StyleSheet.create(factory(c, name)); cache.set(name, s); }
    return s;
  };
}
