/** Screen chrome: the header, a screen with header and footer, the offline banner, badges, field rows, the action bar. */
import type { ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { isOfflineMode, useOnline } from "../net";
import { BORDER, FIXED, makeStyles, num, SIZE, type, useTheme } from "./theme";
import { IconButton } from "./actions";
import { Icon, type IconName } from "./core";

export interface HeadAction { icon: IconName; label: string; onPress: () => void }

/**
 * The 64 dp header of a screen: back when there is somewhere to go back to, title and subtitle,
 * actions at the right. The offline banner pins under it whenever the server cannot be reached.
 */
export function Header({ title, sub, onBack, actions = [], offline = true }: { title: string; sub?: string; onBack?: () => void; actions?: (HeadAction | null | false)[]; offline?: boolean }) {
  const s = useStyles();
  const online = useOnline();
  return (
    <View>
      <View style={s.header}>
        {onBack && <IconButton plain icon="arrow-left" label="Back" onPress={onBack} />}
        <View style={{ flex: 1, minWidth: 0, paddingLeft: onBack ? 0 : 4 }}>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          {!!sub && <Text style={s.sub} numberOfLines={1}>{sub}</Text>}
        </View>
        {actions.filter((a): a is HeadAction => !!a).map((a) => <IconButton key={a.label} plain icon={a.icon} label={a.label} onPress={a.onPress} />)}
      </View>
      {offline && !online && (isOfflineMode()
        ? <OfflineBanner title="Offline mode" meta="Nothing is sent: photos wait on this device. Switch it off in Setup, Offline." />
        : <OfflineBanner />)}
    </View>
  );
}

/** A screen: its header, a scrolling body (or a fixed one), and an optional footer pinned at the thumb. */
export function Screen({ header, children, footer, scroll = true }: { header: ReactNode; children: ReactNode; footer?: ReactNode; scroll?: boolean }) {
  const s = useStyles();
  return (
    <View style={s.screen}>
      {header}
      {scroll
        ? <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
        : <View style={{ flex: 1 }}>{children}</View>}
      {footer && <ActionBar>{footer}</ActionBar>}
    </View>
  );
}

/** Padded block inside a screen (16 dp sides). */
export function Block({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ paddingHorizontal: 16, paddingVertical: 12, gap: 10 }, style]}>{children}</View>;
}

export function OfflineBanner({ meta, title = "Offline" }: { meta?: string; title?: string }) {
  const s = useStyles();
  return (
    <View style={s.offline} accessibilityRole="alert">
      <Icon name="cloud-off" size={22} />
      <View style={{ flex: 1 }}>
        <Text style={s.offlineTitle}>{title}</Text>
        <Text style={s.offlineMeta}>{meta ?? "The server can't be reached. Photos wait on this device."}</Text>
      </View>
    </View>
  );
}

/** Count badge on a control; warning fill, red when something is stuck, accent while it moves. */
export function Badge({ n, stuck, accent }: { n: number; stuck?: boolean; accent?: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Text style={[s.badge, stuck ? { backgroundColor: FIXED.record, color: FIXED.white } : accent ? { backgroundColor: c.accent, color: c.onAccent } : null]}>{n}</Text>
  );
}

/** A setting as a 64 dp row: label (dim) over the value (bold; a placeholder when empty), an error line, a chevron. */
export function FieldRow({ icon, label, value, placeholder = "Not set", error, onPress, trailing }: { icon?: IconName; label: string; value: string | null | undefined; placeholder?: string; error?: string | null; onPress?: () => void; trailing?: ReactNode }) {
  const s = useStyles();
  const { c } = useTheme();
  const empty = !value;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${empty ? placeholder : value}`}
      style={({ pressed }) => [s.field, pressed && { backgroundColor: c.surfaceSunken }]}>
      {icon && <View style={{ width: 24, alignItems: "center" }}><Icon name={icon} color={error ? c.danger : c.text} /></View>}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={s.fieldLabel}>{label}</Text>
        <Text style={[s.fieldValue, empty && s.fieldEmpty]} numberOfLines={2}>{empty ? placeholder : value}</Text>
        {!!error && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Icon name="error" size={16} color={c.danger} />
            <Text style={s.fieldError}>{error}</Text>
          </View>
        )}
      </View>
      {trailing ?? (onPress ? <Icon name="chevron-right" /> : null)}
    </Pressable>
  );
}

/** Decisions pinned in the thumb zone: a bar at the foot of a screen, 2 dp top border. */
export function ActionBar({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return <View style={[s.actionBar, style]}>{children}</View>;
}

const useStyles = makeStyles((c) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  header: { height: SIZE.header, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  title: { ...type("title", "bold"), color: c.text },
  sub: { ...type("small"), color: c.textDim, ...num },
  badge: { position: "absolute", top: -6, right: -6, minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, overflow: "hidden", backgroundColor: c.warn, color: c.onWarn, textAlign: "center", ...type("caption", "heavy"), fontSize: 12, lineHeight: 22 },
  offline: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: c.archive, borderBottomWidth: BORDER.control, borderBottomColor: c.border },
  offlineTitle: { ...type("small", "bold"), color: c.text },
  offlineMeta: { ...type("caption"), color: c.text },
  field: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  fieldLabel: { ...type("small", "semibold"), fontSize: 14, color: c.textDim },
  fieldValue: { ...type("body", "bold"), color: c.text },
  fieldEmpty: { fontFamily: type("body").fontFamily, color: c.textDim },
  fieldError: { ...type("small", "semibold"), fontSize: 14, color: c.danger, flexShrink: 1 },
  actionBar: { flexDirection: "row", gap: 8, paddingTop: 12, paddingHorizontal: 16, paddingBottom: 12, backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.borderSubtle },
}));
