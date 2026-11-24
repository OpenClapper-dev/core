/** Feedback from the design system: banner, empty state, skeleton. Confirm sheets and toasts are in dialogs.tsx. */
import { useEffect, useRef, type ReactNode } from "react";
import { ActivityIndicator, Animated, RefreshControl, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon , type IconName } from "./core";
import { RADIUS, useTheme } from "./theme";
import { useStyles } from "./styles";

type BannerKind = "offline" | "info" | "ok" | "warn" | "danger";

/** Full-width status strip: tinted fill + state border + icon + text. */
export function Banner({ kind, title, meta, icon, action }: { kind: BannerKind; title: string; meta?: string; icon?: IconName; action?: ReactNode }) {
  const s = useStyles();
  const { c } = useTheme();
  const look: Record<BannerKind, { bg: string; border: string; icon: IconName; iconColor: string }> = {
    offline: { bg: c.archive, border: c.borderStrong, icon: "cloud-off", iconColor: c.text },
    info: { bg: c.accentTint, border: c.accent, icon: "cloud-upload", iconColor: c.accent },
    ok: { bg: c.okTint, border: c.ok, icon: "success", iconColor: c.ok },
    warn: { bg: c.warnTint, border: c.warn, icon: "alert", iconColor: c.warnInk },
    danger: { bg: c.dangerTint, border: c.danger, icon: "error", iconColor: c.danger },
  };
  const l = look[kind];
  return (
    <View style={[s.banner, { backgroundColor: l.bg, borderColor: l.border }]} accessibilityRole={kind === "danger" ? "alert" : undefined}>
      <Icon name={icon ?? l.icon} color={l.iconColor} />
      <View style={{ flex: 1 }}>
        <Text style={s.bannerTitle}>{title}</Text>
        {!!meta && <Text style={s.bannerMeta}>{meta}</Text>}
      </View>
      {action}
    </View>
  );
}

/** Whole-screen empty / error / loading message. */
export function Empty({ icon = "image", title, body, loading, children }: { icon?: IconName; title: string; body?: string; loading?: boolean; children?: ReactNode }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>{loading ? <ActivityIndicator color={c.text} /> : <Icon name={icon} size={28} />}</View>
      <Text style={s.emptyTitle}>{title}</Text>
      {!!body && <Text style={s.emptyBody}>{body}</Text>}
      {children && <View style={{ alignSelf: "stretch", gap: 8, marginTop: 8, alignItems: "center" }}>{children}</View>}
    </View>
  );
}

/** Loading placeholder block that pulses (no spinner). */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const v = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.55, duration: 700, useNativeDriver: true }),
    ]));
    a.start();
    return () => a.stop();
  }, [v]);
  return <Animated.View style={[{ backgroundColor: c.surfaceSunken, borderRadius: RADIUS.sm, opacity: v }, style]} />;
}

/** Inline error under a control: small, semibold, red. */
export function ErrorText({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <Text style={s.errorText}>{children}</Text>;
}

/**
 * Pull-to-refresh in the accent colour. A hook that returns the element, because ScrollView and
 * FlatList expect a RefreshControl itself in their `refreshControl` prop, not a wrapper.
 */
export function useRefreshControl(refreshing: boolean, onRefresh: () => void) {
  const { c } = useTheme();
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} />;
}
