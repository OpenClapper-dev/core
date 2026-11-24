/** Navigation controls from the design system: the segmented switch. */
import { Pressable, Text, View } from "react-native";
import { Icon , type IconName } from "./core";
import { SIZE, useTheme } from "./theme";
import { useStyles } from "./styles";

export interface SegOption<T extends string> { id: T; label?: string; icon?: IconName }

/** Segmented switch: one of a few, in a pill. `lg` = 50 dp; `block` stretches the options to the full width. */
export function Seg<T extends string>({ options, value, onChange, accessibilityLabel, size, block, disabled }: { options: readonly SegOption<T>[]; value: T | null; onChange: (v: T) => void; accessibilityLabel?: string; size?: "lg"; block?: boolean; disabled?: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={[s.seg, block && s.segBlock]} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: on, disabled }} accessibilityLabel={o.label ?? o.icon}
            hitSlop={size === "lg" ? 3 : 0}
            style={({ pressed }) => [s.segOpt, size === "lg" && s.segOptLg, block && { flex: 1 }, pressed && !on && { backgroundColor: c.surfaceSunken }, on && { backgroundColor: c.accent }]}>
            {o.icon && <Icon name={o.icon} size={SIZE.iconSm} color={on ? c.onAccent : disabled ? c.textDisabled : c.text} />}
            {o.label && <Text style={[s.segText, on && s.segTextOn, disabled && !on && { color: c.textDisabled }]} numberOfLines={1}>{o.label}</Text>}
          </Pressable>
        );
      })}
    </View>
  );
}
