/** Data display from the design system: photo tag, list row. */
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, type IconName } from "./core";
import { FIXED, useTheme } from "./theme";
import { useStyles } from "./styles";

/** Solid black label over a photo ("Photo 2 / 5", "3 / 9"). */
export function PhotoTag({ children, big, icon }: { children: ReactNode; big?: boolean; icon?: IconName }) {
  const s = useStyles();
  return (
    <View style={[s.photoTag, icon && { flexDirection: "row", gap: 4 }, big && { height: 36, paddingHorizontal: 12 }]}>
      {icon && <Icon name={icon} size={16} color={FIXED.white} />}
      <Text style={[s.photoTagText, big && { fontSize: 17 }]}>{children}</Text>
    </View>
  );
}

/** 64 dp list row: icon, title, meta, trailing (chevron by default). Hub rows, pickers, rig list. */
export function ListRow({ icon, iconColor, title, meta, onPress, onLongPress, trailing, selected, disabled, titleColor }: { icon?: IconName; iconColor?: string; title: string; meta?: string; onPress?: () => void; onLongPress?: () => void; trailing?: ReactNode | null; selected?: boolean; disabled?: boolean; titleColor?: string }) {
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
