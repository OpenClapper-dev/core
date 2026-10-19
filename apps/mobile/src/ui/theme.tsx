import { createContext, useContext, useMemo, type ReactNode } from "react";
import { StyleSheet, useColorScheme, type TextStyle } from "react-native";

/**
 * Design tokens for the phone, from the Fielder design system (fielder-tokens.rn.json, see docs/design.md).
 * Sun = light, for harsh daylight; Set = dark, for dark sets. Every text/background pair here meets the
 * contrast rules (text ≥ 7:1, dim ≥ 4.5:1, control borders ≥ 3:1): re-check a pair when changing a value.
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
  phaseDawn: string; phaseDay: string; phaseDusk: string; phaseNight: string;
  onPhaseDawn: string; onPhaseDay: string; onPhaseDusk: string; onPhaseNight: string;
  chromeBg: string; chromeText: string; chromeBorder: string;
  scrim: string;
}

const SUN: Palette = {
  bg: "#F7F7F5", surface: "#FFFFFF", surfaceRaised: "#FFFFFF", surfaceSunken: "#EBEBE7",
  text: "#0B0B0C", textDim: "#46464C", textDisabled: "#85858C",
  border: "#5E5E66", borderStrong: "#0B0B0C", borderSubtle: "#D2D2CD",
  accent: "#0040D8", accentPressed: "#00288A", onAccent: "#FFFFFF", accentTint: "#E2E9FB",
  focus: "#0B0B0C",
  ok: "#0A6630", okHover: "#08532A", onOk: "#FFFFFF", okTint: "#DCEFE2",
  danger: "#B0121A", dangerHover: "#8F0E15", onDanger: "#FFFFFF", dangerTint: "#F8DEDE",
  warn: "#FFB000", onWarn: "#0B0B0C", warnInk: "#7A4A00", warnTint: "#FFF0C4",
  archive: "#DCDCD8", archiveHover: "#CBCBC6", onArchive: "#0B0B0C",
  phaseDawn: "#F6B3A0", phaseDay: "#FFDF5E", phaseDusk: "#C7A6EE", phaseNight: "#1C2848",
  onPhaseDawn: "#0B0B0C", onPhaseDay: "#0B0B0C", onPhaseDusk: "#0B0B0C", onPhaseNight: "#FFFFFF",
  chromeBg: "#FFFFFF", chromeText: "#0B0B0C", chromeBorder: "#0B0B0C",
  scrim: "rgba(11,11,12,0.72)",
};

const SET: Palette = {
  bg: "#0B0B0C", surface: "#151517", surfaceRaised: "#1E1E21", surfaceSunken: "#050506",
  text: "#EDEDEA", textDim: "#A9A9AF", textDisabled: "#6A6A72",
  border: "#85858E", borderStrong: "#EDEDEA", borderSubtle: "#2E2E33",
  accent: "#6FA2FF", accentPressed: "#5A8FE8", onAccent: "#0B0B0C", accentTint: "#1A2640",
  focus: "#EDEDEA",
  ok: "#3FCB7A", okHover: "#5AD68D", onOk: "#0B0B0C", okTint: "#10301D",
  danger: "#FF6B63", dangerHover: "#FF857E", onDanger: "#0B0B0C", dangerTint: "#3A1414",
  warn: "#F2B33D", onWarn: "#0B0B0C", warnInk: "#F2B33D", warnTint: "#33270C",
  archive: "#3A3A40", archiveHover: "#46464D", onArchive: "#EDEDEA",
  phaseDawn: "#7A3A2C", phaseDay: "#554710", phaseDusk: "#533477", phaseNight: "#16213F",
  onPhaseDawn: "#EDEDEA", onPhaseDay: "#EDEDEA", onPhaseDusk: "#EDEDEA", onPhaseNight: "#EDEDEA",
  chromeBg: "#0B0B0C", chromeText: "#EDEDEA", chromeBorder: "#85858E",
  scrim: "rgba(0,0,0,0.72)",
};

export type ThemeName = "sun" | "set";
/** "auto" follows the phone's dark-mode setting. */
export type ThemeChoice = "auto" | ThemeName;
export const PALETTES: Record<ThemeName, Palette> = { sun: SUN, set: SET };

/** Theme-independent colours: things drawn over photos or the camera image, which never take the theme. */
export const FIXED = {
  photoBg: "#000000",
  frameLine: "#FFFFFF",
  frameOutline: "#000000",
  mask: "rgba(0,0,0,0.62)",
  human: "#00E5FF",
  record: "#D0121B",
  white: "#FFFFFF",
  black: "#000000",
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
const ThemeContext = createContext<Theme>({ name: "sun", choice: "auto", c: SUN });

export function resolveTheme(choice: ThemeChoice, os: string | null | undefined): ThemeName {
  return choice === "auto" ? (os === "dark" ? "set" : "sun") : choice;
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
