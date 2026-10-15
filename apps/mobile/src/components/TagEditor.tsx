import { useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { CAMERA_SUPPORTS, extraSummary, label, LIGHT, MOVEMENTS, PHASE_ICONS, selectOptions, SHOT_SIZE_ABBR, SHOT_SIZES, WEATHER, type Extra, type ExtraValue, type FieldDef } from "@fielder/vocab";
import type { LocationEntry, ShotTags } from "../types";
import { BORDER, Button, Chip, ChipRow, ErrorText, FieldRow, Hint, Icon, Input, makeStyles, SectionHeading, Seg, Sheet, SheetSearch, Switch, type, useTheme } from "../ui";
import { OptionSheet, rankMatches } from "./OptionSheet";

/** The tags being edited, plus a location typed in the sheet that does not exist yet (created on save). */
export interface TagDraft { tags: ShotTags; newLocation: LocationEntry | null }

export const EMPTY_TAGS: ShotTags = { name: null, light: [], artificial: false, weather: null, int_ext: null, location_id: null, shot_size: null, camera_support: null, movement: [], extra: {} };

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
export function TagEditor({ value, onChange, projectId, locations: allLocations, countAt, fields, projectName, remembered, onTouched, lastLocationId }: Props) {
  const s = useStyles();
  const locations = useMemo(() => allLocations.filter((l) => l.projectId === projectId), [allLocations, projectId]);
  const [open, setOpen] = useState<Open>(null);
  /** Dependent selects emptied by a parent change: shown with an error line until picked again. */
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  /** Groups the user opened or closed; others start open when empty, collapsed when filled. */
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const { tags, newLocation } = value;
  const set = (patch: Partial<ShotTags>, key: string, nl: LocationEntry | null = newLocation) => { onTouched?.(key); onChange({ tags: { ...tags, ...patch }, newLocation: nl }); };
  const last = (key: string) => !!remembered?.has(key);

  const setExtra = (path: string[], v: ExtraValue) => {
    const r = setIn(tags.extra, fields, path, v);
    const p = path.join(".");
    setCleared((cur) => { const n = new Set(cur); n.delete(p); for (const c of r.cleared) n.add(c); return n; });
    set({ extra: r.extra }, `extra.${path[0]}`);
  };

  const location = tags.location_id ? locations.find((l) => l.id === tags.location_id) ?? null : null;
  const locationText = newLocation ? `${newLocation.name} · new` : location?.name ?? null;
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

      <LocationSheet visible={open?.kind === "location"} onClose={() => setOpen(null)} projectId={projectId} locations={locations} countAt={countAt} lastId={lastLocationId ?? null}
        selectedId={newLocation ? newLocation.id : tags.location_id}
        onPick={(l, created) => set({ location_id: l?.id ?? null }, "location_id", l && (created || l.id === newLocation?.id) ? l : null)} extra={newLocation} />
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
 * Search or create a location. Empty query: the last used first, then by shots there. Typing:
 * prefix matches first, then contains; "Create “…”" is the first row unless the name exists.
 */
function LocationSheet({ visible, onClose, projectId, locations, countAt, lastId, selectedId, onPick, extra }: { visible: boolean; onClose: () => void; projectId: string; locations: LocationEntry[]; countAt: (id: string) => number; lastId: string | null; selectedId: string | null; onPick: (l: LocationEntry | null, created: boolean) => void; extra: LocationEntry | null }) {
  const s = useStyles();
  const { c } = useTheme();
  const [q, setQ] = useState("");
  const all = useMemo(() => (extra && !locations.some((l) => l.id === extra.id) ? [...locations, extra] : locations), [locations, extra]);
  const list = useMemo(() => {
    if (q.trim()) return rankMatches(all, q, (l) => l.name);
    return [...all].sort((a, b) => (a.id === lastId ? -1 : b.id === lastId ? 1 : countAt(b.id) - countAt(a.id) || a.name.localeCompare(b.name)));
  }, [all, q, lastId, countAt]);
  const name = q.trim();
  const exact = all.find((l) => l.name.trim().toLowerCase() === name.toLowerCase());
  const close = () => { setQ(""); onClose(); };
  const pick = (l: LocationEntry, created = false) => { onPick(selectedId === l.id ? null : l, created); close(); };
  const create = () => pick({ id: Crypto.randomUUID(), projectId, name, createdAt: new Date().toISOString(), synced: false }, true);
  return (
    <Sheet visible={visible} title="Location" onClose={close} height={0.86} scroll={false}>
      <SheetSearch value={q} onChangeText={setQ} placeholder="Search or type a new location" autoFocus autoCapitalize="words" maxLength={80} onSubmitEditing={() => { if (exact) pick(exact); else if (name) create(); }} />
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
        ListEmptyComponent={!name ? <View style={{ padding: 20 }}><Hint>No locations yet. Type a name to create the first one.</Hint></View> : null}
        renderItem={({ item }) => {
          const on = item.id === selectedId;
          const n = countAt(item.id);
          return (
            <Pressable onPress={() => pick(item)} style={({ pressed }) => [s.item, on && s.itemOn, pressed && { backgroundColor: c.surfaceSunken }]} accessibilityState={{ selected: on }}>
              <Icon name={on ? "check" : item.synced ? "map-marker-outline" : "map-marker-plus-outline"} color={on ? c.accent : c.text} />
              <Text style={[s.itemName, on && s.itemNameOn]} numberOfLines={2}>{item.name}</Text>
              <Text style={s.itemMeta}>{item.id === lastId ? "last used · " : ""}{n} shot{n === 1 ? "" : "s"}</Text>
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
