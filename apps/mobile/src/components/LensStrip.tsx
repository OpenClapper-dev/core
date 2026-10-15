import { useEffect, useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { lensList, stepLens } from "../lens";
import { BORDER, Icon, makeStyles, num, RADIUS, type, useTheme } from "../ui";
import type { LensRange } from "../types";

interface Props {
  lensMm: number;
  onChange: (mm: number) => void;
  /** Landscape: an 80 dp column with the values stacked. */
  vertical: boolean;
  range: LensRange | null;
  /** Tap on the selected value: the Lens sheet (any focal length). */
  onPressValue: () => void;
}

/**
 * The rig's focal lengths as one scrollable strip on the chrome. Tap a value to use it; the
 * selected one is an accent pill with "mm"; tapping it opens the Lens sheet. A focal length typed
 * in the sheet joins the strip; outside the rig's range it is struck through.
 */
export function LensStrip({ lensMm, onChange, vertical, range, onPressValue }: Props) {
  const s = useStyles();
  const { c } = useTheme();
  const scroller = useRef<ScrollView>(null);
  const pos = useRef<Record<number, number>>({});
  const size = useRef(0);
  const base = lensList(range);
  const values = base.includes(lensMm) ? base : [...base, lensMm].sort((a, b) => a - b);
  const outside = (mm: number) => !!range && (mm < range.min || mm > range.max);

  // Keep the selected value in view.
  useEffect(() => {
    const at = pos.current[lensMm];
    if (at == null) return;
    const target = Math.max(0, at - size.current / 2 + 30);
    scroller.current?.scrollTo(vertical ? { y: target, animated: true } : { x: target, animated: true });
  }, [lensMm, vertical]);

  return (
    <ScrollView ref={scroller} horizontal={!vertical} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
      onLayout={(e) => { size.current = vertical ? e.nativeEvent.layout.height : e.nativeEvent.layout.width; }}
      style={vertical ? { width: 80 } : { flexGrow: 0 }}
      contentContainerStyle={[s.strip, vertical ? s.col : s.row]}>
      {values.map((mm) => {
        const on = mm === lensMm;
        const off = outside(mm);
        return (
          <Pressable key={mm} onPress={() => (on ? onPressValue() : onChange(mm))}
            onLayout={(e) => { pos.current[mm] = vertical ? e.nativeEvent.layout.y : e.nativeEvent.layout.x; }}
            accessibilityRole="button" accessibilityState={{ selected: on }}
            accessibilityLabel={on ? `Lens ${mm} mm${off ? ", outside the rig's range" : ""}. Tap for any focal length` : `Use ${mm} mm`}
            style={({ pressed }) => [s.val, vertical && s.valCol, on && s.valOn, pressed && !on && { backgroundColor: c.surfaceSunken }]}>
            <Text style={[s.mm, on && s.mmOn, off && s.struck]}>{mm}</Text>
            {on && <Text style={[s.unit, off && s.struck]}>mm</Text>}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((c) => ({
  strip: { alignItems: "center", gap: 6 },
  row: { flexDirection: "row", paddingHorizontal: 8, justifyContent: "center", flexGrow: 1 },
  col: { flexDirection: "column", paddingVertical: 8, justifyContent: "center", flexGrow: 1 },
  val: { minWidth: 52, height: 52, paddingHorizontal: 10, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center", borderWidth: BORDER.control, borderColor: c.chromeBorder },
  valCol: { width: 64, minWidth: 64, height: 52 },
  valOn: { backgroundColor: c.accent, borderColor: c.accent, height: 56, paddingHorizontal: 14 },
  mm: { ...type("title", "bold"), color: c.chromeText, ...num },
  mmOn: { fontFamily: type("title", "heavy").fontFamily, color: c.onAccent, lineHeight: 24 },
  unit: { ...type("caption", "bold"), fontSize: 11, lineHeight: 12, color: c.onAccent },
  struck: { textDecorationLine: "line-through" },
  carousel: { alignItems: "center", gap: 4 },
  arrow: { width: 48, height: 48, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center" },
}));

/**
 * The lens as one value between previous / next buttons (issue #49, "Carousel"): less room than the
 * strip. Previous and next follow the strip's order (shorter first); tapping the value opens the Lens sheet.
 */
export function LensCarousel({ lensMm, onChange, vertical, range, onPressValue }: Props) {
  const s = useStyles();
  const { c } = useTheme();
  const values = lensList(range);
  const outside = !!range && (lensMm < range.min || lensMm > range.max);
  const step = (dir: -1 | 1) => { const n = stepLens(values, lensMm, dir); if (n !== lensMm) onChange(n); };
  const arrow = (dir: -1 | 1) => (
    <Pressable onPress={() => step(dir)} accessibilityRole="button" accessibilityLabel={dir < 0 ? "Shorter lens" : "Longer lens"}
      style={({ pressed }) => [s.arrow, pressed && { backgroundColor: c.surfaceSunken }]}>
      <Icon name={vertical ? (dir < 0 ? "chevron-up" : "chevron-down") : dir < 0 ? "chevron-left" : "chevron-right"} size={28} color={c.chromeText} />
    </Pressable>
  );
  return (
    <View style={[s.carousel, vertical ? s.col : s.row]}>
      {arrow(-1)}
      <Pressable onPress={onPressValue} accessibilityRole="button" accessibilityLabel={`Lens ${lensMm} mm${outside ? ", outside the rig's range" : ""}. Tap for any focal length`}
        style={[s.val, vertical && s.valCol, s.valOn]}>
        <Text style={[s.mm, s.mmOn, outside && s.struck]}>{lensMm}</Text>
        <Text style={[s.unit, outside && s.struck]}>mm</Text>
      </Pressable>
      {arrow(1)}
    </View>
  );
}
