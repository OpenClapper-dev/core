import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { emptyCanvas, itemTimes, shotCover, type FrameValues, type ItemData, type ShotBody } from "@openclapper/model";
import { authHeaders, canCall, canvasImageUrl, putFile, type FileRec } from "../api";
import { loadLibrary, takeFile, useDefinitions, useLibraryMap, usePlaces, usePresets } from "../media/library";
import { MapWeb } from "../places/MapWeb";
import { Picture, useSeen, type PicRef } from "../places/picture";
import { useProject } from "../projects";
import { useBack } from "../shell/back";
import { onOpen, openApp } from "../shell/nav";
import { Block, Button, Empty, FIXED, Header, Hint, Icon, IconButton, ListRow, makeStyles, RADIUS, Screen, SectionLabel, Seg, Sheet, SheetList, toast, type, useTheme, type IconName } from "../ui";
import { CanvasWeb } from "./CanvasView";
import { PhotoProperties } from "./PhotoProperties";
import { registerApp } from "./registry";

/**
 * Shots, Sets and Locations on the phone (docs/features/shots.md, docs/rewrite/ux-5-phone.md): a list with
 * each one's picture, and one touch form for all three: the picture, a shot's progression played back, the
 * content (added, reordered, removed; a canvas opens in the editor), the properties as in Media. A set lists
 * the shots that play there, a location the sets filmed there; Locations also shows a map. Changes need a
 * connection, as a new canvas does.
 */
type Kind = "shot" | "set" | "location";
const KINDS: Record<Kind, { app: string; label: string; plural: string; icon: IconName }> = {
  shot: { app: "shots", label: "Shot", plural: "Shots", icon: "slate" },
  set: { app: "sets", label: "Set", plural: "Sets", icon: "home" },
  location: { app: "locations", label: "Location", plural: "Locations", icon: "location" },
};
const isPos = (v: unknown): v is { lat: number; lng: number } => !!v && typeof v === "object" && typeof (v as { lat: unknown }).lat === "number";

/** The picture a shot, set or location is shown by: its progression's first item, else the first photo or canvas of its content. */
function coverRef(f: FileRec, files: ReadonlyMap<string, FileRec>): { ref: PicRef; def: FrameValues | null } | null {
  const c = shotCover((f.refs ?? []) as Parameters<typeof shotCover>[0], (id) => { const x = files.get(id); return x && !x.deleted_at ? x.type : null; });
  if (!c) return null;
  return { ref: { to: c.to, frame: c.frame }, def: c.rule === "progression" ? (f.body as Partial<ShotBody> | undefined)?.progression?.frame ?? null : null };
}

function Tile({ f, files, onPress }: { f: FileRec; files: ReadonlyMap<string, FileRec>; onPress: () => void }) {
  const s = useStyles();
  const { width } = useWindowDimensions();
  const presets = usePresets();
  const cover = coverRef(f, files);
  const seen = useSeen(cover?.ref ?? null, files, presets, cover?.def ?? null);
  const cols = Math.max(2, Math.floor(width / 200)), w = width / cols - 2;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={f.name} style={s.tile}>
      {cover ? <Picture seen={seen} width={w} height={(w * 3) / 4} /> : <View style={[s.none, { width: w, height: (w * 3) / 4 }]}><Icon name={KINDS[f.type as Kind].icon} size={32} color={FIXED.white} /></View>}
      <View style={s.nameBar}><Text style={s.nameText} numberOfLines={1}>{f.name}</Text></View>
    </Pressable>
  );
}

function PlacesApp({ kind, active }: { kind: Kind; active: boolean }) {
  const project = useProject();
  const list = usePlaces(kind);
  const files = useLibraryMap();
  const defs = useDefinitions();
  const { width } = useWindowDimensions();
  const [open, setOpen] = useState<string | null>(null);
  const [map, setMap] = useState(kind === "location");
  const cols = Math.max(2, Math.floor(width / 200));
  useEffect(() => { if (active) void loadLibrary(); }, [active, project?.id]);
  useEffect(() => onOpen(KINDS[kind].app, setOpen), []);
  useBack(open ? () => setOpen(null) : null, active);
  const current = open ? files.get(open) : undefined;
  if (open && current) return <Form f={current} files={files} back={() => setOpen(null)} />;
  const k = KINDS[kind];
  const make = async () => {
    if (!project || !canCall()) { toast(`A new ${k.label.toLowerCase()} needs a connection`, "danger"); return; }
    try { const id = randomUUID(); takeFile(await putFile(id, { type: kind, project_id: project.id })); setOpen(id); }
    catch (e) { toast(`Not made: ${(e as Error).message}`, "danger"); }
  };
  const posDefs = defs.filter((d) => d.def.field === "position");
  const pins = list.flatMap((f) => { for (const d of posDefs) { const v = f.values?.[d.id]; if (isPos(v)) return [{ id: f.id, name: f.name, lat: v.lat, lng: v.lng }]; } return []; });
  return (
    <Screen scroll={false} header={<Header title={k.plural} sub={project?.name} actions={[{ icon: "plus", label: `New ${k.label.toLowerCase()}`, onPress: () => void make() }]} />}>
      {kind === "location" && <Block style={{ paddingVertical: 8 }}><Seg block options={[{ id: "map", label: "Map" }, { id: "list", label: "List" }]} value={map ? "map" : "list"} onChange={(v) => setMap(v === "map")} accessibilityLabel="View" /></Block>}
      {kind === "location" && map ? (
        <View style={{ flex: 1 }}>
          <MapWeb pins={pins} onPick={setOpen} />
          {pins.length < list.length && <Block style={{ paddingVertical: 6 }}><Hint>{list.length - pins.length} of {list.length} without a position: give one in a location's Position.</Hint></Block>}
        </View>
      ) : (
        <FlatList key={cols} data={list} numColumns={cols} keyExtractor={(f) => f.id} contentContainerStyle={{ paddingBottom: 24 }}
          columnWrapperStyle={{ gap: 2, paddingHorizontal: 1 }} ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
          ListEmptyComponent={<Empty icon={k.icon} title={`No ${k.plural.toLowerCase()} yet`} body={`Make one with the plus. The Studio makes them too, and assembles their pictures.`} />}
          renderItem={({ item }) => <Tile f={item} files={files} onPress={() => setOpen(item.id)} />} />
      )}
    </Screen>
  );
}

/** The touch form of one shot, set or location. */
function Form({ f, files, back }: { f: FileRec; files: ReadonlyMap<string, FileRec>; back: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const { width, height } = useWindowDimensions();
  const presets = usePresets();
  const defs = useDefinitions();
  const kind = f.type as Kind, k = KINDS[kind];
  const refs = f.refs ?? [];
  const content = refs.filter((r) => r.kind === "content").map((r) => r.to);
  const prog = kind === "shot" ? (f.body as Partial<ShotBody> | undefined)?.progression ?? null : null;
  const items = prog ? refs.filter((r) => r.kind === "item").map((r) => ({ to: r.to, data: r.data as unknown as ItemData })) : [];
  const overlayId = prog ? refs.find((r) => r.kind === "overlay")?.to : undefined;
  const overlay = overlayId ? files.get(overlayId) : undefined;
  const overlaySrc = prog?.overlayShown && overlay && overlay.updated_at !== overlay.created_at ? { uri: canvasImageUrl(overlay, "render"), headers: authHeaders() } : null;
  const times = prog ? itemTimes(prog.timing, items.map((i) => i.data)) : [];
  const total = times.reduce((a, b) => a + b, 0);
  const starts = times.map((_, i) => times.slice(0, i).reduce((a, b) => a + b, 0));
  const [pick, setPick] = useState<{ list: "prog" | "content"; i: number } | null>(null);
  const [t, setT] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState(f.name);
  useEffect(() => setName(f.name), [f.name]);
  useBack(editing ? () => setEditing(null) : back);

  // Playback on the clock: a smooth move takes the time it says.
  const raf = useRef(0);
  useEffect(() => {
    if (t === null) return;
    const t0 = Date.now() - t;
    const tick = () => { const now = Date.now() - t0; if (now >= total) setT(null); else { setT(now); raf.current = requestAnimationFrame(tick); } };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [t === null, total]);
  const playing = t !== null ? Math.max(0, starts.findIndex((st, i) => t < st + times[i])) : null;
  const sel = playing !== null ? { list: "prog" as const, i: playing } : pick ?? (items.length ? { list: "prog" as const, i: 0 } : content.length ? { list: "content" as const, i: 0 } : null);
  const item = sel?.list === "prog" ? items[sel.i] : null;
  const ref: PicRef | null = !sel ? null : item ? { to: item.to, frame: item.data.frame, move: item.data.move } : { to: content[sel.i] };
  const u = playing !== null && t !== null ? Math.min(1, (t - starts[playing]) / times[playing]) : 0;
  const seen = useSeen(ref, files, presets, item ? prog!.frame : null, u);

  /** Saves the content list; the progression and overlay stay as they are. */
  const saveContent = async (next: string[]) => {
    if (!canCall()) { toast("Changing the content needs a connection", "danger"); return; }
    try { takeFile(await putFile(f.id, { type: f.type, project_id: f.project_id!, refs: [...next.map((to) => ({ kind: "content", to })), ...refs.filter((r) => r.kind !== "content").map((r) => ({ kind: r.kind, to: r.to, data: r.data }))] })); }
    catch (e) { toast(`Not saved: ${(e as Error).message}`, "danger"); }
  };
  const rename = async () => {
    const n = name.trim().slice(0, 120);
    if (!n || n === f.name) { setName(f.name); return; }
    if (!canCall()) { toast("Renaming needs a connection", "danger"); setName(f.name); return; }
    try { takeFile(await putFile(f.id, { type: f.type, project_id: f.project_id!, name: n })); } catch (e) { toast(`Not renamed: ${(e as Error).message}`, "danger"); setName(f.name); }
  };
  const drawCanvas = async () => {
    if (!canCall()) { toast("A new canvas needs a connection", "danger"); return; }
    try {
      const id = randomUUID();
      takeFile(await putFile(id, { type: "canvas", project_id: f.project_id!, internal_of: f.id, body: emptyCanvas() as unknown as Record<string, unknown> }));
      await saveContent([...content, id]);
      setEditing(id);
    } catch (e) { toast(`No canvas: ${(e as Error).message}`, "danger"); }
  };

  if (editing) return <CanvasWeb id={editing} name={files.get(editing)?.name ?? "Canvas"} onClose={() => { setEditing(null); void loadLibrary(); }} />;
  const stageH = Math.min(height * 0.42, (width * 3) / 4);
  // Who points here: the shots of a set, the sets of a location (their reference properties).
  const refDefs = defs.filter((d) => d.def.field === "reference" && (d.def.targets ?? []).includes(kind));
  const pointing = kind === "shot" ? [] : [...files.values()].filter((x) => x.type === (kind === "set" ? "shot" : "set") && !x.internal_of && refDefs.some((d) => { const v = x.values?.[d.id]; return (Array.isArray(v) ? v : [v]).includes(f.id); }));
  const thumbW = 96;
  return (
    <Screen header={<Header title={f.name} sub={k.label} onBack={back} />}>
      <View style={{ alignItems: "center", paddingTop: 8 }}>
        {ref ? <Picture seen={seen} width={width - 16} height={stageH} overlay={item ? overlaySrc : null} />
          : <View style={[s.none, { width: width - 16, height: stageH / 2 }]}><Icon name={k.icon} size={36} color={FIXED.white} /></View>}
        {seen?.file && <Text style={s.caption} numberOfLines={1}>{seen.file.name}</Text>}
      </View>
      {prog && (
        <>
          <Block style={{ paddingTop: 8 }}>
            <View style={s.row}>
              <IconButton icon={t !== null ? "pause" : "play"} label={t !== null ? "Pause" : "Play the progression"} disabled={!items.length} onPress={() => setT(t !== null ? null : 0)} />
              <Text style={s.meta}>{items.length} {items.length === 1 ? "picture" : "pictures"} · {(total / 1000).toFixed(1)} s{t !== null ? ` · ${(t / 1000).toFixed(1)} s` : ""}</Text>
            </View>
          </Block>
          <ScrollView horizontal contentContainerStyle={{ gap: 4, paddingHorizontal: 8 }}>
            {items.map((it, i) => <Thumb key={i} r={{ to: it.to, frame: it.data.frame }} def={prog.frame} files={files} w={thumbW} on={sel?.list === "prog" && sel.i === i} label={`${(times[i] / 1000).toFixed(1)} s`} onPress={() => { setT(null); setPick({ list: "prog", i }); }} />)}
          </ScrollView>
        </>
      )}
      <Block style={{ paddingTop: 12 }}>
        <Text style={s.label}>Name</Text>
        <TextInput value={name} onChangeText={setName} onEndEditing={() => void rename()} returnKeyType="done" maxLength={120} style={[s.input, { color: c.text }]} />
      </Block>
      <Block style={{ paddingTop: 12 }}><SectionLabel>{`Content · ${content.length}`}</SectionLabel></Block>
      {content.length ? (
        <ScrollView horizontal contentContainerStyle={{ gap: 4, paddingHorizontal: 8 }}>
          {content.map((id, i) => { const x = files.get(id); return <Thumb key={id + i} r={{ to: id }} def={null} files={files} w={thumbW} on={sel?.list === "content" && sel.i === i} label={x?.name ?? "Missing file"} onPress={() => { setT(null); setPick({ list: "content", i }); }} onLongPress={() => setMenu(i)} />; })}
        </ScrollView>
      ) : <Block><Hint>Nothing yet. Add photos and canvases of the project; press and hold one for more.</Hint></Block>}
      <Block style={{ paddingTop: 8, flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><Button kind="secondary" icon="plus" label="Add files" onPress={() => setAdding(true)} /></View>
        <View style={{ flex: 1 }}><Button kind="secondary" icon="brush" label="Draw a canvas" onPress={() => void drawCanvas()} /></View>
      </Block>
      {pointing.length > 0 && (
        <>
          <Block style={{ paddingTop: 12 }}><SectionLabel>{kind === "set" ? "Shots that play here" : "Sets filmed here"}</SectionLabel></Block>
          {pointing.map((x) => <ListRow key={x.id} icon={KINDS[x.type as Kind].icon} title={x.name} onPress={() => openApp(KINDS[x.type as Kind].app, x.id)} />)}
        </>
      )}
      <PhotoProperties fileId={f.id} type={f.type} />
      {menu !== null && (
        <Sheet visible title={files.get(content[menu])?.name ?? "Missing file"} onClose={() => setMenu(null)}>
          <SheetList>
            {files.get(content[menu])?.type === "canvas" && <ListRow icon="brush" title="Draw on it" onPress={() => { const id = content[menu]; setMenu(null); setEditing(id); }} />}
            {menu > 0 && <ListRow icon="arrow-left" title="Earlier" trailing={null} onPress={() => { const n = [...content]; [n[menu - 1], n[menu]] = [n[menu], n[menu - 1]]; setMenu(null); void saveContent(n); }} />}
            {menu < content.length - 1 && <ListRow icon="arrow-right" title="Later" trailing={null} onPress={() => { const n = [...content]; [n[menu + 1], n[menu]] = [n[menu], n[menu + 1]]; setMenu(null); void saveContent(n); }} />}
            <ListRow icon="close" title="Remove from the content" trailing={null} titleColor={c.danger} onPress={() => { const n = content.filter((_, i) => i !== menu); setMenu(null); setPick(null); void saveContent(n); }} />
          </SheetList>
        </Sheet>
      )}
      {adding && <AddSheet files={files} self={f.id} have={content} onClose={() => setAdding(false)} onAdd={(ids) => { setAdding(false); void saveContent([...content, ...ids.filter((x) => !content.includes(x))]); }} />}
    </Screen>
  );
}

function Thumb({ r, def, files, w, on, label, onPress, onLongPress }: { r: PicRef; def: FrameValues | null; files: ReadonlyMap<string, FileRec>; w: number; on: boolean; label: string; onPress: () => void; onLongPress?: () => void }) {
  const s = useStyles();
  const presets = usePresets();
  const seen = useSeen(r, files, presets, def);
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel={label} style={[s.thumb, on && s.thumbOn, { width: w }]}>
      <Picture seen={seen} width={w - 4} height={((w - 4) * 3) / 4} />
      <Text style={s.thumbText} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

/** Files of the project to add: photos, canvases and other files; nothing internal, none of the project's settings. */
function AddSheet({ files, self, have, onClose, onAdd }: { files: ReadonlyMap<string, FileRec>; self: string; have: string[]; onClose: () => void; onAdd: (ids: string[]) => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const offered = [...files.values()].filter((x) => x.id !== self && !x.internal_of && !x.fixed && !x.deleted_at && !have.includes(x.id) && ["photo", "canvas", "shot", "set", "location"].includes(x.type))
    .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const icon = (t: string): IconName => (t === "photo" ? "image" : t === "canvas" ? "brush" : KINDS[t as Kind]?.icon ?? "file");
  return (
    <Sheet visible title="Add files" sub={chosen.length ? `${chosen.length} chosen` : "Pick several"} onClose={onClose} doneLabel="Add" onDone={() => onAdd(chosen)}>
      <SheetList>
        {!offered.length ? <Block><Hint>Nothing else in the project to add.</Hint></Block>
          : offered.map((x) => <ListRow key={x.id} icon={icon(x.type)} title={x.name} selected={chosen.includes(x.id)} trailing={null} onPress={() => setChosen(chosen.includes(x.id) ? chosen.filter((y) => y !== x.id) : [...chosen, x.id])} />)}
      </SheetList>
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  tile: { flex: 1, backgroundColor: FIXED.photoBg, overflow: "hidden" },
  none: { alignItems: "center", justifyContent: "center", backgroundColor: FIXED.photoBg },
  nameBar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: FIXED.mask },
  nameText: { ...type("small", "semibold"), color: FIXED.white },
  caption: { ...type("small"), color: c.textDim, marginTop: 4, paddingHorizontal: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  meta: { ...type("small"), color: c.textDim },
  label: { ...type("small", "semibold"), fontSize: 14, color: c.textDim, marginBottom: 6 },
  input: { ...type("body"), minHeight: 48, backgroundColor: c.surface, borderWidth: 2, borderColor: c.border, borderRadius: RADIUS.sm, paddingHorizontal: 14 },
  thumb: { padding: 2, borderRadius: RADIUS.sm, borderWidth: 2, borderColor: "transparent" },
  thumbOn: { borderColor: c.accent },
  thumbText: { ...type("small"), fontSize: 12, color: c.text, marginTop: 2 },
}));

const Shots = ({ active }: { active: boolean }) => <PlacesApp kind="shot" active={active} />;
const Sets = ({ active }: { active: boolean }) => <PlacesApp kind="set" active={active} />;
const Locations = ({ active }: { active: boolean }) => <PlacesApp kind="location" active={active} />;
registerApp({ id: "shots", label: "Shots", icon: "slate", needsProject: true, Screen: Shots });
registerApp({ id: "sets", label: "Sets", icon: "home", needsProject: true, Screen: Sets });
registerApp({ id: "locations", label: "Locations", icon: "location", needsProject: true, Screen: Locations });
