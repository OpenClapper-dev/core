/** Data display from the design system: review state, sequence badge, photo tag, list row. */
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { label as vocabLabel, STATE_ICONS, type ShotState } from "@openclapper/vocab";
import { Icon } from "./core";
import { FIXED, useTheme } from "./theme";
import { useStyles } from "./styles";

/** Review state: fill + icon + label (colours shared with the Studio). */
export function StateMarker({ state, iconOnly, lg }: { state: ShotState; iconOnly?: boolean; lg?: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  const look = state === "approved" ? { bg: c.ok, fg: c.onOk, border: c.ok } : state === "archived" ? { bg: c.archive, fg: c.onArchive, border: c.border } : { bg: c.warn, fg: c.onWarn, border: c.onWarn };
  return (
    <View style={[s.state, lg && s.stateLg, { backgroundColor: look.bg, borderColor: look.border }, iconOnly && s.stateIcon]} accessibilityLabel={vocabLabel(state)}>
      <Icon name={STATE_ICONS[state]} size={lg ? 18 : 16} color={look.fg} />
      {!iconOnly && <Text style={[s.stateText, lg && { fontSize: 13 }, { color: look.fg }]}>{vocabLabel(state)}</Text>}
    </View>
  );
}

/** "SEQ · n": solid black over photos; red with a dot while recording. */
export function SeqBadge({ count, recording }: { count: number; recording?: boolean }) {
  const s = useStyles();
  return (
    <View style={[s.seq, recording && s.seqRec]} accessibilityLabel={`${count} photos in sequence`}>
      {recording ? <View style={s.seqDot} /> : <Icon name="layers-triple" size={15} color={FIXED.white} />}
      <Text style={[s.seqText, recording && { fontSize: 15 }]}>SEQ · {count}</Text>
    </View>
  );
}

/** Solid black label over a photo ("Photo 2 / 5", "3 / 9"). */
export function PhotoTag({ children, big, icon }: { children: ReactNode; big?: boolean; icon?: string }) {
  const s = useStyles();
  return (
    <View style={[s.photoTag, icon && { flexDirection: "row", gap: 4 }, big && { height: 36, paddingHorizontal: 12 }]}>
      {icon && <Icon name={icon} size={16} color={FIXED.white} />}
      <Text style={[s.photoTagText, big && { fontSize: 17 }]}>{children}</Text>
    </View>
  );
}

/** 64 dp list row: icon, title, meta, trailing (chevron by default). Hub rows, pickers, rig list. */
export function ListRow({ icon, iconColor, title, meta, onPress, onLongPress, trailing, selected, disabled, titleColor }: { icon?: string; iconColor?: string; title: string; meta?: string; onPress?: () => void; onLongPress?: () => void; trailing?: ReactNode | null; selected?: boolean; disabled?: boolean; titleColor?: string }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} disabled={disabled || !onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected, disabled }}
      style={({ pressed }) => [s.listRow, selected && s.listRowOn, pressed && { backgroundColor: c.surfaceSunken }]}>
      {selected ? <Icon name="check" color={c.accent} /> : icon ? <Icon name={icon} color={iconColor ?? (disabled ? c.textDisabled : c.text)} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.listTitle, selected && s.listTitleOn, disabled && { color: c.textDisabled }, titleColor ? { color: titleColor } : null]} numberOfLines={2}>{title}</Text>
        {!!meta && <Text style={s.listMeta} numberOfLines={2}>{meta}</Text>}
      </View>
      {trailing === undefined ? (onPress ? <Icon name="chevron-right" /> : null) : trailing}
    </Pressable>
  );
}
