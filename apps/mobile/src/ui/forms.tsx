/** Form controls from the design system: chips, input, switch, toggle row, checkbox. */
import { useState, type ReactNode } from "react";
import { Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { IconButton } from "./actions";
import { Icon } from "./core";
import { SIZE, useTheme } from "./theme";
import { useStyles } from "./styles";

export function Row({ label, children }: { label: string; children?: ReactNode }) {
  const s = useStyles();
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <View style={{ gap: 8 }}>{children}</View>
    </View>
  );
}

/** Pill for choosing. Selected = accent fill + bold + check, so it never relies on colour alone. */
export function Chip({ label, selected, onPress, danger, icon, swatch, disabled, block }: { label: string; selected?: boolean; onPress: () => void; danger?: boolean; icon?: string; /** A colour sample (e.g. frame colour). */ swatch?: string; disabled?: boolean; /** Fills its grid cell. */ block?: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  const fg = disabled ? c.textDisabled : selected ? c.onAccent : danger ? c.danger : c.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityState={{ selected: !!selected, disabled }}
      style={({ pressed }) => [s.chip, block && s.chipBlock, danger && { borderColor: c.danger }, pressed && !selected && s.chipPressed, selected && s.chipSelected, disabled && s.chipDisabled]}>
      {selected && <Icon name="check" size={SIZE.iconSm} color={fg} />}
      {icon && <Icon name={icon} size={SIZE.iconSm} color={fg} />}
      {swatch && <View style={[s.swatch, { backgroundColor: swatch }]} />}
      <Text style={[s.chipText, selected && s.chipTextSelected, { color: fg }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <View style={s.chipRow}>{children}</View>;
}

export function Input(props: TextInputProps) {
  const s = useStyles();
  const { c } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput placeholderTextColor={c.textDim} selectionColor={c.accent} {...props}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      style={[s.input, focused && s.inputFocused, props.style]} />
  );
}

/**
 * A password input with an eye button beside it that shows what was typed (issue #144: passwords are
 * easy to mistype on a phone). Hidden again on every mount; only secureTextEntry flips, so autofill
 * and the keyboard keep working.
 */
export function PasswordInput(props: Omit<TextInputProps, "secureTextEntry">) {
  const [shown, setShown] = useState(false);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Input autoCapitalize="none" autoCorrect={false} {...props} secureTextEntry={!shown} style={[{ flex: 1 }, props.style]} />
      <IconButton icon={shown ? "eye-off-outline" : "eye-outline"} label={shown ? "Hide password" : "Show password"} disabled={props.editable === false} onPress={() => setShown((v) => !v)} />
    </View>
  );
}

/** The switch itself (drawn, so the off state keeps a visible border in sunlight). */
export function Switch({ value, disabled }: { value: boolean; disabled?: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={[s.track, value && { backgroundColor: c.accent, borderColor: c.accent }, disabled && { borderStyle: "dashed", borderColor: c.textDisabled }]}>
      <View style={[s.knob, value ? { left: 25, backgroundColor: c.onAccent } : { left: 3, backgroundColor: disabled ? c.textDisabled : c.textDim }]}>
        {value && <Icon name="check" size={14} color={c.accent} />}
      </View>
    </View>
  );
}

/** A labelled on/off row; the whole row toggles. 64 dp with an optional icon and meta line. */
export function Toggle({ label, meta, icon, value, onChange, disabled }: { label: string; meta?: string; icon?: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} disabled={disabled} style={({ pressed }) => [s.toggleRow, pressed && { backgroundColor: c.surfaceSunken }]} accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} accessibilityLabel={label}>
      {icon && <Icon name={icon} color={disabled ? c.textDisabled : c.text} />}
      <View style={{ flex: 1 }}>
        <Text style={[s.toggleLabel, disabled && { color: c.textDisabled }]}>{label}</Text>
        {!!meta && <Text style={s.listMeta}>{meta}</Text>}
      </View>
      <Switch value={value} disabled={disabled} />
    </Pressable>
  );
}

export function Checkbox({ checked }: { checked: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  return <View style={[s.check, checked && { backgroundColor: c.accent, borderColor: c.accent }]}>{checked && <Icon name="check-bold" size={18} color={c.onAccent} />}</View>;
}

/** Chips in a two-column grid whose cells fill their half (use `Chip block`). */
export function ChipGrid({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <View style={s.chipGrid}>{children}</View>;
}

/** One cell of a ChipGrid. */
export function ChipCell({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <View style={s.chipCell}>{children}</View>;
}
