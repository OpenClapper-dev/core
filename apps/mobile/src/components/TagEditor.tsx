import { useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { CAMERA_SUPPORTS, extraSummary, label, LIGHT, MOVEMENTS, PHASE_ICONS, selectOptions, SHOT_SIZE_ABBR, SHOT_SIZES, WEATHER, type Extra, type ExtraValue, type FieldDef } from "@openclapper/vocab";
import type { LocationEntry, ShotTags, SpotEntry } from "../types";
import { BORDER, Button, Chip, ChipRow, ErrorText, FieldRow, Hint, Icon, Input, makeStyles, SectionHeading, Seg, Sheet, SheetSearch, Switch, type, useTheme } from "../ui";
import { OptionSheet, rankMatches } from "./OptionSheet";

/** The tags being edited, plus a location typed in the sheet that does not exist yet (created on save). */
/** A location or spot made in the editor travels with the draft until it is saved or queued. */
export interface TagDraft { tags: ShotTags; newLocation: LocationEntry | null; newSpot: SpotEntry | null }

export const EMPTY_TAGS: ShotTags = { name: null, light: [], artificial: false, weather: null, int_ext: null, location_id: null, spot_id: null, shot_size: null, camera_support: null, movement: [], extra: {} };

const SUPPORT_ICONS: Record<string, string> = {
  static: "tripod", handheld: "hand-back-right-outline", steadicam: "human-handsdown", gimbal: "axis-arrow", dolly: "car-pickup",
  slider: "arrow-left-right", crane: "crane", drone: "quadcopter", vehicle: "car-outline",
};
/** "WS · Wide" */
const sizeLabel = (v: string) => `${SHOT_SIZE_ABBR[v as keyof typeof SHOT_SIZE_ABBR] ?? v} · ${label(v)}`;

export const WEATHER_ICONS: Record<string, string> = {
  none: "minus-circle-outline", sunny: "weather-sunny", partly_cloudy: "weather-partly-cloudy", cloudy: "weather-cloudy",
  rainy: "weather-rainy", stormy: "weather-lightning", foggy: "weather-fog", snow: "weather-snowy",
};
const INT_EXT_OPTIONS = [{ id: "int", label: "INT", icon: "home-outline" }, { id: "ext", label: "EXT", icon: "pine-tree" }] as const;

interface Props {
  value: TagDraft;
  onChange: (v: TagDraft) => void;
  /** The shot's project: its locations are offered, new ones are created in it. */
  projectId: string;
  locations: LocationEntry[];
  /** Every spot on the phone; the chosen location's are offered. */
  spots: SpotEntry[];
  countAt: (locationId: string) => number;
  /** The project's extra fields, in its order. */
  fields: readonly FieldDef[];
  projectName?: string;
  /** Keys still showing the value kept from the last capture ("location_id", "extra.<key>", …). */
  remembered?: ReadonlySet<string>;
  /** Called with the key a change touched, so its LAST tag goes away. */
  onTouched?: (key: string) => void;
  /** Location picked most recently (listed first when the search is empty). */
  lastLocationId?: string | null;
}

type Open =
  | { kind: "location" }
  | { kind: "spot" }
  | { kind: "weather" }
  | { kind: "size" }
  | { kind: "support" }
  | { kind: "select"; path: string[]; def: FieldDef; siblings: Extra; parentLabel?: string }
  | { kind: "value"; path: string[]; def: FieldDef }
  | null;

const isObj = (v: ExtraValue | undefined): v is Extra => !!v && typeof v === "object" && !Array.isArray(v);
const getIn = (extra: Extra, path: string[]): ExtraValue | undefined => path.reduce<ExtraValue | undefined>((v, k) => (isObj(v) ? v[k] : undefined), extra);

/** Sets a value; a changed parent drops dependent selects that no longer offer their value (returned as `cleared` paths). */
function setIn(extra: Extra, defs: readonly FieldDef[], path: string[], v: ExtraValue): { extra: Extra; cleared: string[] } {
  const [k, ...rest] = path;
  if (rest.length === 0) {
    const next: Extra = { ...extra, [k]: v };
    if (v === null) delete next[k];
    const cleared: string[] = [];
    for (const d of defs) {
      if (d.optionsBy?.field !== k || next[d.key] == null) continue;
      const opts = selectOptions(d, next);
      const cur = next[d.key];
      const ok = Array.isArray(cur) ? cur.every((x) => opts.includes(String(x))) : opts.includes(String(cur));
      if (!ok) { delete next[d.key]; cleared.push(d.key); }
    }
    return { extra: next, cleared };
  }
  const group = defs.find((d) => d.key === k);
  const inner = isObj(extra[k]) ? (extra[k] as Extra) : {};
  const r = setIn(inner, group?.fields ?? [], rest, v);
  return { extra: { ...extra, [k]: r.extra }, cleared: r.cleared.map((c) => `${k}.${c}`) };
}

const shown = (v: ExtraValue | undefined): string | null =>
  v === undefined || v === null || v === "" ? null : typeof v === "boolean" ? (v ? "Yes" : "No") : Array.isArray(v) ? (v.length ? v.join(", ") : null) : String(v);

/**
 * The one tag editor (Tag after capture, Review edit, Shot details edit). INT/EXT and light are
 * one tap in place; location, weather and every extra field are 64 dp rows that open a sheet.
 */
export function TagEditor({ value, onChange, projectId, locations: allLocations, spots: allSpots, countAt, fields, projectName, remembered, onTouched, lastLocationId }: Props) {
  const s = useStyles();
  const locations = useMemo(() => allLocations.filter((l) => l.projectId === projectId), [allLocations, projectId]);
  const [open, setOpen] = useState<Open>(null);
  /** Dependent selects emptied by a parent change: shown with an error line until picked again. */
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  /** Groups the user opened or closed; others start open when empty, collapsed when filled. */
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const { tags, newLocation, newSpot } = value;
  const set = (patch: Partial<ShotTags>, key: string, nl: LocationEntry | null = newLocation, ns: SpotEntry | null = newSpot) => { onTouched?.(key); onChange({ tags: { ...tags, ...patch }, newLocation: nl, newSpot: ns }); };
  const last = (key: string) => !!remembered?.has(key);

  const setExtra = (path: string[], v: ExtraValue) => {
    const r = setIn(tags.extra, fields, path, v);
    const p = path.join(".");
    setCleared((cur) => { const n = new Set(cur); n.delete(p); for (const c of r.cleared) n.add(c); return n; });
    set({ extra: r.extra }, `extra.${path[0]}`);
  };

  const location = tags.location_id ? locations.find((l) => l.id === tags.location_id) ?? null : null;
  const locationText = newLocation ? `${newLocation.name} · new` : location?.name ?? null;
  const locationId = newLocation?.id ?? tags.location_id;
  const spots = useMemo(() => allSpots.filter((x) => x.locationId === locationId), [allSpots, locationId]);
  const spot = tags.spot_id ? spots.find((x) => x.id === tags.spot_id) ?? null : null;
  const spotText = newSpot ? `${newSpot.name} · new` : spot?.name ?? null;
  const toggleLight = (v: string) => set({ light: tags.light.includes(v) ? tags.light.filter((x) => x !== v) : [...tags.light, v] }, "light");

  const rows = (defs: readonly FieldDef[], values: Extra, prefix: string[], depth: number): ReactNode[] => defs.flatMap((f) => {
    const path = [...prefix, f.key];
    const key = path.join(".");
    const v = values[f.key];
    const isLast = depth === 0 && last(`extra.${f.key}`);
    if (f.type === "group") {
      const inner = isObj(v) ? v : {};
      const hasError = [...cleared].some((c) => c.startsWith(`${key}.`));
      const isOpen = groupOpen[key] ?? (hasError || Object.keys(inner).length === 0);
      return [
        <FieldRow key={key} icon={depth === 0 ? "folder-outline" : undefined} label={f.label} value={isOpen ? null : extraSummary(f.fields ?? [], inner) || null} placeholder={isOpen ? `${(f.fields ?? []).length} fields` : "Not set"}
          remembered={isLast} group open={isOpen} depth={depth} onPress={() => setGroupOpen((g) => ({ ...g, [key]: !isOpen }))} />,
        ...(isOpen ? rows(f.fields ?? [], inner, path, depth + 1) : []),
      ];
    }
    if (f.type === "boolean") {
      return [
        <FieldRow key={key} label={f.label} value={shown(v)} remembered={isLast} depth={depth}
          onPress={() => setExtra(path, v === true ? false : true)} trailing={<Switch value={v === true} />} />,
      ];
    }
    if (f.type === "select") {
      const opts = selectOptions(f, values);
      const parent = f.optionsBy ? defs.find((d) => d.key === f.optionsBy?.field) : undefined;
      const parentValue = f.optionsBy ? values[f.optionsBy.field] : undefined;
      const blocked = !!f.optionsBy && opts.length === 0;
      return [
        <FieldRow key={key} label={f.label} value={shown(v)} placeholder={blocked ? `Choose ${parent?.label ?? f.optionsBy?.field} first` : "Not set"} remembered={isLast} depth={depth}
          error={cleared.has(key) ? `Pick again: ${parent?.label ?? "the parent"} changed` : null}
          onPress={() => { if (!blocked) setOpen({ kind: "select", path, def: f, siblings: values, parentLabel: typeof parentValue === "string" ? parentValue : undefined }); }} />,
      ];
    }
    return [<FieldRow key={key} label={f.label} value={shown(v)} remembered={isLast} depth={depth} onPress={() => setOpen({ kind: "value", path, def: f })} />];
  });

  const sel = open?.kind === "select" ? open : null;
  const selValue = sel ? getIn(tags.extra, sel.path) : undefined;
  const val = open?.kind === "value" ? open : null;

  return (
    <View>
      <View style={s.block}>
        <Text style={s.label}>Name</Text>
        <Input value={tags.name ?? ""} onChangeText={(t) => set({ name: t || null }, "name")} placeholder="e.g. Bridge from the east bank" autoCapitalize="sentences" maxLength={120} multiline blurOnSubmit returnKeyType="done" style={{ maxHeight: 84 }} />
        <LabelWithLast text="INT / EXT" last={last("int_ext") && !!tags.int_ext} />
        <Seg size="lg" block accessibilityLabel="Interior or exterior" value={tags.int_ext} onChange={(v) => set({ int_ext: tags.int_ext === v ? null : v }, "int_ext")} options={INT_EXT_OPTIONS} />
        <LabelWithLast text="Light · every phase the shot works in" last={last("light") && (tags.light.length > 0 || tags.artificial)} />
        <ChipRow>
          {LIGHT.map((l) => <Chip key={l} icon={PHASE_ICONS[l]} label={label(l)} selected={tags.light.includes(l)} onPress={() => toggleLight(l)} />)}
          <Chip icon={PHASE_ICONS.artificial} label="Artificial" selected={tags.artificial} onPress={() => set({ artificial: !tags.artificial }, "light")} />
        </ChipRow>
      </View>
      <FieldRow icon="map-marker-outline" label="Location" value={locationText} remembered={last("location_id")} onPress={() => setOpen({ kind: "location" })} />
      {locationId && <FieldRow icon="map-marker-radius-outline" label="Spot" value={spotText} placeholder="Anywhere at the location" remembered={last("spot_id")} depth={1} onPress={() => setOpen({ kind: "spot" })} />}
      <FieldRow icon={WEATHER_ICONS[tags.weather ?? ""] ?? "weather-partly-cloudy"} label="Weather" value={tags.weather ? label(tags.weather) : null} remembered={last("weather")} onPress={() => setOpen({ kind: "weather" })} />
      <SectionHeading>Camera</SectionHeading>
      <FieldRow icon="crop" label="Shot size" value={tags.shot_size ? sizeLabel(tags.shot_size) : null} onPress={() => setOpen({ kind: "size" })} />
      <FieldRow icon={SUPPORT_ICONS[tags.camera_support ?? ""] ?? "video-outline"} label="Camera support" value={tags.camera_support ? label(tags.camera_support) : null} remembered={last("camera_support")} onPress={() => setOpen({ kind: "support" })} />
      <View style={s.block}>
        <Text style={s.label}>Movement · any number</Text>
        <ChipRow>
          {MOVEMENTS.map((m) => <Chip key={m} label={label(m)} selected={tags.movement.includes(m)} onPress={() => set({ movement: MOVEMENTS.filter((x) => (x === m ? !tags.movement.includes(x) : tags.movement.includes(x))) }, "movement")} />)}
        </ChipRow>
      </View>
      {fields.length > 0 && (
        <>
          <SectionHeading>{projectName ? `${projectName} fields` : "Project fields"}</SectionHeading>
          {rows(fields, tags.extra, [], 0)}
        </>
      )}

      <PlaceSheet visible={open?.kind === "location"} onClose={() => setOpen(null)} title="Location" noun="location" icon="map-marker" items={locations} countAt={countAt} lastId={lastLocationId ?? null}
        selectedId={locationId} extra={newLocation}
        make={(name) => ({ id: Crypto.randomUUID(), projectId, name, createdAt: new Date().toISOString(), synced: false })}
        onPick={(l, created) => {
          const nl = l && (created || l.id === newLocation?.id) ? l : null;
          // A spot belongs to its location: another location clears it.
          if ((l?.id ?? null) === locationId) set({}, "location_id", nl);
          else set({ location_id: l?.id ?? null, spot_id: null }, "location_id", nl, null);
        }} />
      {locationId && <PlaceSheet visible={open?.kind === "spot"} onClose={() => setOpen(null)} title="Spot" noun="spot" icon="map-marker-radius" items={spots} lastId={null}
        selectedId={newSpot ? newSpot.id : tags.spot_id} extra={newSpot}
        make={(name) => ({ id: Crypto.randomUUID(), locationId, name, createdAt: new Date().toISOString(), synced: false })}
        onPick={(x, created) => set({ spot_id: x?.id ?? null }, "spot_id", newLocation, x && (created || x.id === newSpot?.id) ? x : null)} />}
      <OptionSheet visible={open?.kind === "weather"} title="Weather" columns={2} options={WEATHER.map((w) => ({ id: w, label: label(w), icon: WEATHER_ICONS[w] }))}
        value={tags.weather ? [tags.weather] : []} onChange={(ids) => set({ weather: ids[0] ?? null }, "weather")} onClose={() => setOpen(null)} />
      <OptionSheet visible={open?.kind === "size"} title="Shot size" sub="Widest to tightest" options={SHOT_SIZES.map((v) => ({ id: v, label: sizeLabel(v) }))}
        value={tags.shot_size ? [tags.shot_size] : []} onChange={(ids) => set({ shot_size: ids[0] ?? null }, "shot_size")} onClose={() => setOpen(null)} />
      <OptionSheet visible={open?.kind === "support"} title="Camera support" columns={2} options={CAMERA_SUPPORTS.map((v) => ({ id: v, label: label(v), icon: SUPPORT_ICONS[v] }))}
        value={tags.camera_support ? [tags.camera_support] : []} onChange={(ids) => set({ camera_support: ids[0] ?? null }, "camera_support")} onClose={() => setOpen(null)} />
      {sel && (
        <OptionSheet visible title={sel.parentLabel ? `${sel.def.label} · ${sel.parentLabel}` : sel.def.label} multiple={sel.def.multiple}
          options={selectOptions(sel.def, sel.siblings).map((o) => ({ id: o, label: o }))}
          value={Array.isArray(selValue) ? selValue.map(String) : typeof selValue === "string" ? [selValue] : []}
          onChange={(ids) => setExtra(sel.path, sel.def.multiple ? (ids.length ? ids : null) : ids[0] ?? null)} onClose={() => setOpen(null)} />
      )}
      {val && <ValueSheet def={val.def} value={getIn(tags.extra, val.path)} onSave={(v) => setExtra(val.path, v)} onClose={() => setOpen(null)} />}
    </View>
  );
}

function LabelWithLast({ text, last }: { text: string; last: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
      <Text style={[s.label, { flex: 1 }]}>{text}</Text>
      {last && <View style={s.last}><Icon name="history" size={14} color={c.textDim} /><Text style={s.lastText}>LAST</Text></View>}
    </View>
  );
}

/**
 * Search or create a location or a spot. Empty query: the last used first, then by shots there (or by
 * name). Typing: prefix matches first, then contains; "Create “…”" is the first row unless the name exists.
 */
function PlaceSheet<T extends { id: string; name: string; synced: boolean }>({ visible, onClose, title, noun, icon, items, countAt, lastId, selectedId, onPick, extra, make }: {
  visible: boolean; onClose: () => void; title: string; noun: string; icon: string; items: T[]; countAt?: (id: string) => number; lastId: string | null;
  selectedId: string | null; onPick: (x: T | null, created: boolean) => void; extra: T | null; make: (name: string) => T;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const [q, setQ] = useState("");
  const all = useMemo(() => (extra && !items.some((l) => l.id === extra.id) ? [...items, extra] : items), [items, extra]);
  const list = useMemo(() => {
    if (q.trim()) return rankMatches(all, q, (l) => l.name);
    return [...all].sort((a, b) => (a.id === lastId ? -1 : b.id === lastId ? 1 : (countAt ? countAt(b.id) - countAt(a.id) : 0) || a.name.localeCompare(b.name)));
  }, [all, q, lastId, countAt]);
  const name = q.trim();
  const exact = all.find((l) => l.name.trim().toLowerCase() === name.toLowerCase());
  const close = () => { setQ(""); onClose(); };
  const pick = (l: T, created = false) => { onPick(selectedId === l.id ? null : l, created); close(); };
  const create = () => pick(make(name), true);
  return (
    <Sheet visible={visible} title={title} onClose={close} height={0.86} scroll={false}>
      <SheetSearch value={q} onChangeText={setQ} placeholder={`Search or type a new ${noun}`} autoFocus autoCapitalize="words" maxLength={80} onSubmitEditing={() => { if (exact) pick(exact); else if (name) create(); }} />
      <FlatList
        data={list}
        keyExtractor={(l) => l.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 32 }}
        ListHeaderComponent={name && !exact ? (
          <Pressable onPress={create} style={({ pressed }) => [s.item, pressed && { backgroundColor: c.accentTint }]} accessibilityRole="button">
            <Icon name="plus" color={c.accent} />
            <Text style={[s.itemName, { color: c.accent }]}>Create “{name}”</Text>
          </Pressable>
        ) : null}
        ListEmptyComponent={!name ? <View style={{ padding: 20 }}><Hint>No {noun}s yet. Type a name to create the first one.</Hint></View> : null}
        renderItem={({ item }) => {
          const on = item.id === selectedId;
          const n = countAt?.(item.id);
          return (
            <Pressable onPress={() => pick(item)} style={({ pressed }) => [s.item, on && s.itemOn, pressed && { backgroundColor: c.surfaceSunken }]} accessibilityState={{ selected: on }}>
              <Icon name={on ? "check" : item.synced ? `${icon}-outline` : "map-marker-plus-outline"} color={on ? c.accent : c.text} />
              <Text style={[s.itemName, on && s.itemNameOn]} numberOfLines={2}>{item.name}</Text>
              {n !== undefined && <Text style={s.itemMeta}>{item.id === lastId ? "last used · " : ""}{n} shot{n === 1 ? "" : "s"}</Text>}
            </Pressable>
          );
        }}
      />
    </Sheet>
  );
}

/** A number or text extra field in its own sheet; Done applies, Clear empties. */
function ValueSheet({ def, value, onSave, onClose }: { def: FieldDef; value: ExtraValue | undefined; onSave: (v: ExtraValue) => void; onClose: () => void }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const numeric = def.type === "number";
  const n = Number(text.replace(",", "."));
  const bad = numeric && text.trim() !== "" && !Number.isFinite(n);
  const done = () => { if (bad) return; onSave(text.trim() === "" ? null : numeric ? n : text); onClose(); };
  return (
    <Sheet visible title={def.label} onClose={onClose} leadLabel="Cancel" doneLabel="Done" onDone={done}>
      <Input value={text} onChangeText={setText} autoFocus keyboardType={numeric ? "decimal-pad" : "default"} multiline={!numeric} style={!numeric ? { minHeight: 96, textAlignVertical: "top" } : undefined} onSubmitEditing={numeric ? done : undefined} />
      {bad && <ErrorText>Enter a number.</ErrorText>}
      {!!def.help && <Hint>{def.help}</Hint>}
      {value != null && <Button kind="secondary" icon="close" label="Clear" onPress={() => { onSave(null); onClose(); }} />}
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  block: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, gap: 8, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  label: { ...type("small", "semibold"), fontSize: 14, color: c.textDim },
  last: { flexDirection: "row", alignItems: "center", gap: 4, height: 24, paddingHorizontal: 7, borderRadius: 3, borderWidth: BORDER.badge, borderColor: c.border },
  lastText: { ...type("caption", "bold"), fontSize: 12, letterSpacing: 0.7, color: c.textDim },
  item: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  itemOn: { backgroundColor: c.accentTint },
  itemName: { ...type("body", "semibold"), color: c.text, flex: 1 },
  itemNameOn: { fontFamily: type("body", "heavy").fontFamily },
  itemMeta: { ...type("small"), color: c.textDim },
}));
