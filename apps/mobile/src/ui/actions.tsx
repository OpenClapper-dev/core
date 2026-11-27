/** Actions from the design system: "rectangles act". Every button on the phone is one of these. */
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon , type IconName } from "./core";
import { SIZE, useTheme } from "./theme";
import { useStyles } from "./styles";

export type ButtonKind = "primary" | "approve" | "archive" | "secondary" | "ghost" | "danger" | "dangerSolid";

/**
 * primary = accent, approve = green, archive = neutral grey, secondary/ghost = outlined,
 * danger = red outline, dangerSolid = red fill (inside a confirmation only). Disabled is dashed.
 */
export function Button({ label, onPress, kind = "primary", disabled, icon, busy, style, big }: { label: string; onPress: () => void; kind?: ButtonKind; disabled?: boolean; icon?: IconName; busy?: boolean; style?: StyleProp<ViewStyle>; /** Fills its container's height (landscape action columns). */ big?: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  const outline = { bg: "transparent", pressed: c.surfaceSunken, border: c.border, fg: c.text };
  const look: Record<ButtonKind, { bg: string; pressed: string; border: string; fg: string }> = {
    primary: { bg: c.accent, pressed: c.accentPressed, border: c.accent, fg: c.onAccent },
    approve: { bg: c.ok, pressed: c.okHover, border: c.ok, fg: c.onOk },
    archive: { bg: c.archive, pressed: c.archiveHover, border: c.border, fg: c.onArchive },
    secondary: outline,
    ghost: outline,
    danger: { bg: "transparent", pressed: c.dangerTint, border: c.danger, fg: c.danger },
    dangerSolid: { bg: c.danger, pressed: c.dangerHover, border: c.danger, fg: c.onDanger },
  };
  const l = look[kind];
  const fg = disabled ? c.textDisabled : l.fg;
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      style={({ pressed }) => [s.btn, big && s.btnBig, { backgroundColor: pressed ? l.pressed : l.bg, borderColor: l.border }, pressed && { transform: [{ translateY: 1 }] }, disabled && s.btnDisabled, style]}>
      {busy ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={big ? 30 : 22} color={fg} /> : null}
      <Text style={[s.btnText, big && s.btnTextBig, { color: fg }]} numberOfLines={big ? 2 : 1}>{label}</Text>
    </Pressable>
  );
}

/** Square icon-only button (48 dp, 2 dp border) with an accessible name; `on` makes it a toggle shown filled while on. */
export function IconButton({ icon, label, onPress, onLongPress, disabled, color, size = SIZE.touchMin, plain, on }: { icon: IconName; label: string; onPress: () => void; onLongPress?: () => void; disabled?: boolean; color?: string; size?: number; /** No border (header lead). */ plain?: boolean; /** A toggle: on or off (undefined: a plain button). */ on?: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} disabled={disabled} accessibilityRole={on === undefined ? "button" : "togglebutton"} accessibilityLabel={label} accessibilityState={on === undefined ? undefined : { checked: on, disabled }} hitSlop={4}
      style={({ pressed }) => [s.iconBtn, { width: size, height: size }, plain && { borderColor: "transparent", backgroundColor: "transparent" }, pressed && { backgroundColor: c.surfaceSunken }, on && { backgroundColor: c.accent, borderColor: c.accent }, disabled && { borderStyle: "dashed", borderColor: c.textDisabled }]}>
      <Icon name={icon} size={26} color={disabled ? c.textDisabled : on ? c.onAccent : color} />
    </Pressable>
  );
}

/** Controls side by side, 8 dp apart (button pairs, two inputs); give them `style={{ flex: n }}` to share the width. */
export function SideBySide({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <View style={s.sideBySide}>{children}</View>;
}
