/** Form controls from the design system: chips, input, switch, toggle row, checkbox. */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, Text, TextInput, View, type TextInputProps } from "react-native";
import { IconButton } from "./actions";
import { Icon } from "./core";
import { makeStyles, num, SIZE, type, useTheme } from "./theme";
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

/**
 * A value on a track: drag anywhere on it, or step with − and + for an exact value (on set, in
 * gloves). Hand-written on PanResponder like components/gestures.ts. `onChange` fires on every
 * step while dragging; callers that send it somewhere coalesce (fixtures/queue.ts).
 */
export function Slider({ label, value, min, max, step = 1, format = String, onChange, disabled }: { label: string; value: number; min: number; max: number; step?: number; format?: (v: number) => string; onChange: (v: number) => void; disabled?: boolean }) {
  const s = useSliderStyles();
  const [width, setWidth] = useState(0);
  const r = useRef({ min, max, step, width, onChange, disabled, x0: 0, last: value });
  r.current = { ...r.current, min, max, step, width, onChange, disabled, last: value };
  const snap = (v: number) => {
    const { min: lo, max: hi, step: st } = r.current;
    return Math.min(hi, Math.max(lo, Math.round((v - lo) / st) * st + lo));
  };
  const emit = (v: number) => {
    const next = snap(v);
    if (next === r.current.last) return;
    r.current.last = next;
    r.current.onChange(next);
  };
  const at = (x: number) => { const { min: lo, max: hi, width: w } = r.current; return w > 0 ? lo + (x / w) * (hi - lo) : lo; };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !r.current.disabled,
    onMoveShouldSetPanResponder: () => !r.current.disabled,
    // A slider inside a scroll view keeps the drag once it has it.
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { r.current.x0 = e.nativeEvent.locationX; emit(at(r.current.x0)); },
    onPanResponderMove: (_, g) => emit(at(r.current.x0 + g.dx)),
  }).panHandlers, []);
  const frac = max > min ? (Math.min(max, Math.max(min, value)) - min) / (max - min) : 0;
  const nudge = (dir: 1 | -1) => emit(value + dir * step);
  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={[s.label, disabled && s.dim]}>{label}</Text>
        <Text style={[s.value, disabled && s.dim]}>{format(value)}</Text>
      </View>
      <View style={s.row}>
        <IconButton icon="minus" label={`Less ${label.toLowerCase()}`} onPress={() => nudge(-1)} disabled={disabled || value <= min} />
        <View style={s.track} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...pan}
          accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min, max, now: value, text: format(value) }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={(e) => nudge(e.nativeEvent.actionName === "increment" ? 1 : -1)}>
          <View pointerEvents="none" style={[s.rail, disabled && s.railOff]} />
          <View pointerEvents="none" style={[s.fill, { width: frac * width }, disabled && s.fillOff]} />
          <View pointerEvents="none" style={[s.thumb, { left: frac * width - THUMB / 2 }, disabled && s.thumbOff]} />
        </View>
        <IconButton icon="plus" label={`More ${label.toLowerCase()}`} onPress={() => nudge(1)} disabled={disabled || value >= max} />
      </View>
    </View>
  );
}

const THUMB = 26;
const useSliderStyles = makeStyles((c) => ({
  wrap: { gap: 4 },
  head: { flexDirection: "row", justifyContent: "space-between" },
  label: { ...type("body", "semibold"), color: c.text },
  value: { ...type("body", "semibold"), color: c.text, ...num },
  dim: { color: c.textDisabled },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  track: { flex: 1, height: SIZE.touchMin, justifyContent: "center" },
  rail: { position: "absolute", left: 0, right: 0, height: 6, borderRadius: 3, backgroundColor: c.surfaceSunken, borderWidth: 1, borderColor: c.border },
  railOff: { borderColor: c.borderSubtle },
  fill: { position: "absolute", left: 0, height: 6, borderRadius: 3, backgroundColor: c.accent },
  fillOff: { backgroundColor: c.textDisabled },
  thumb: { position: "absolute", width: THUMB, height: THUMB, borderRadius: THUMB / 2, backgroundColor: c.surface, borderWidth: 3, borderColor: c.accent },
  thumbOff: { borderColor: c.textDisabled },
}));
