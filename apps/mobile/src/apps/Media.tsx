import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FlatList, Pressable, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import * as DocumentPicker from "expo-document-picker";
import { device } from "../device";
import { log } from "../log";
import { usePrefs, type Prefs } from "../prefs";
import { useProject } from "../projects";
import { imageSource } from "../media/cache";
import { binPhoto, loadLibrary, useCanvases, usePresets, type MediaCanvas, makeCollection, onLoading, photoFile, placePhotos, renamePhoto, useLibrary, type Holder, type MediaPhoto } from "../media/library";
import { addImports } from "../media/pipeline";
import { discard, queue, queuedUri, retry } from "../media/queue";
import { useBack } from "../shell/back";
import { onOpen } from "../shell/nav";
import { persisted } from "../store";
import { Banner, Block, Button, catColor, confirm, Empty, FieldRow, FIXED, Header, Hint, Icon, ListRow, makeStyles, num, RADIUS, Screen, SectionLabel, Seg, Sheet, toast, type, useRefreshControl, useTheme } from "../ui";
import { authHeaders, canvasImageUrl } from "../api";
import { CanvasPage, CanvasWeb } from "./CanvasView";
import { PhotoProperties } from "./PhotoProperties";
import { registerApp } from "./registry";

/**
 * Media on the phone (docs/rewrite/ux-5-phone.md): every photo of the project, or its folders with
 * the photos at the top level below them. Collections as stacks in their colour, or spread out with
 * each photo carrying its collection's mark (the account's preference, as in the Studio). A badge on
 * what is still uploading or stuck. Import from the phone runs through the camera's pipeline; the
 * tick chooses photos to make a collection.
 */
const view = persisted<"photos" | "folders">("mediaView.v1", "photos");
const spreadOut = persisted<boolean>("mediaSpread.v1", false);

type Open = { kind: "photo" | "collection" | "folder" | "canvas" | "edit"; id: string };

function Media({ active }: { active: boolean }) {
  const project = useProject();
  const lib = useLibrary();
  const canvases = useCanvases();
  const presets = usePresets();
  const [stack, setStack] = useState<Open[]>([]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const top = stack[stack.length - 1] ?? null;
  const push = (o: Open) => setStack((st) => [...st, o]);
  const pop = () => setStack((st) => st.slice(0, -1));
  useBack(picked ? () => setPicked(null) : stack.length ? pop : null, active);
  useEffect(() => onOpen("media", (id) => { setPicked(null); setStack([{ kind: "photo", id }]); }), []);
  useEffect(() => { if (active) void loadLibrary(); }, [active, project?.id]);
  const seen = useRef(project?.id);
  useEffect(() => { if (seen.current !== project?.id) { seen.current = project?.id; setStack([]); setPicked(null); } }, [project?.id]);

  if (top?.kind === "canvas" || top?.kind === "edit") {
    const c = canvases.find((x) => x.id === top.id);
    if (c && top.kind === "edit") return <CanvasWeb id={c.id} name={c.name} onClose={pop} />;
    if (c) return <CanvasPage canvas={c.file} presets={presets} back={pop} onEdit={() => push({ kind: "edit", id: c.id })} />;
  }
  if (top?.kind === "photo") {
    const p = lib.photos.find((x) => x.id === top.id);
    if (p) return <PhotoPage photo={p} holders={lib.holders} back={pop} />;
  }
  const holder = top && (top.kind === "folder" || top.kind === "collection") ? lib.holders.find((h) => h.id === top.id) ?? null : null;
  return <Browser key={holder?.id ?? "root"} holder={holder} lib={lib} canvases={canvases} picked={picked} setPicked={setPicked} open={push} back={stack.length ? pop : undefined} />;
}

function Browser({ holder, lib, canvases, picked, setPicked, open, back }: { holder: Holder | null; lib: ReturnType<typeof useLibrary>; canvases: MediaCanvas[]; picked: string[] | null; setPicked: (p: string[] | null) => void; open: (o: Open) => void; back?: () => void }) {
  const s = useStyles();
  const project = useProject();
  const mode = view.use();
  const spread = spreadOut.use();
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => onLoading(setRefreshing), []);
  const refresh = useRefreshControl(refreshing, () => void loadLibrary());
  const colls = lib.holders.filter((h) => h.type === "collection");
  const inColl = holder?.type === "collection";
  // What this level shows: a collection its photos; a folder (or the folders view's top) what sits in it; else every photo.
  const level = holder ? holder.id : null;
  const byFolder = mode === "folders" || holder?.type === "folder";
  const photoFolder = (p: MediaPhoto) => { const c = colls.find((x) => x.id === p.container); return c ? c.container : p.container; };
  const photos = inColl ? lib.photos.filter((p) => p.container === holder.id) : byFolder ? lib.photos.filter((p) => photoFolder(p) === level) : lib.photos;
  const folders = byFolder && !inColl ? lib.holders.filter((h) => h.type === "folder" && h.container === level) : [];
  const stacked = !spread && !picked && !inColl;
  const stacks = stacked ? colls.filter((c) => (byFolder ? c.container === level : true)).map((c) => ({ c, list: lib.photos.filter((p) => p.container === c.id) })).filter((x) => x.list.length) : [];
  const loose = stacked ? photos.filter((p) => !colls.some((c) => c.id === p.container)) : photos;

  const importPictures = async () => {
    if (!project) return;
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: ["image/*"], multiple: true, copyToCacheDirectory: true });
      if (r.canceled || !r.assets.length) return;
      toast(`Importing ${r.assets.length}…`, "neutral");
      const { added, failed } = await addImports(project.id, r.assets, holder?.id ?? null);
      toast(failed.length ? `${added} imported; ${failed.length} could not be read` : `${added} imported`, failed.length ? "danger" : "ok");
    } catch (e) { log("warn", "import picker failed", e); toast("The pictures could not be imported", "danger"); }
  };
  const make = async () => {
    if (!picked?.length) return;
    const n = colls.length + 1;
    try { await makeCollection(picked, `Collection ${n}`, holder?.type === "folder" ? holder.id : null); setPicked(null); toast(`Collection ${n} made`); }
    catch (e) { toast(`No collection: ${(e as Error).message}`, "danger"); }
  };

  const title = picked ? `${picked.length} chosen` : holder?.name ?? "Media";
  const sub = picked ? "Tap photos to choose them" : holder ? (inColl ? `Collection · ${photos.length} photos` : "Folder") : project?.name;
  return (
    <Screen scroll={false}
      header={<Header title={title} sub={sub} onBack={picked ? () => setPicked(null) : back}
        actions={picked ? [] : [!inColl && { icon: spread ? "layers" : "grid", label: spread ? "Collections as stacks" : "Collections spread out", onPress: () => spreadOut.set(!spread) }, { icon: "download", label: "Import from the phone", onPress: () => void importPictures() }, { icon: "check", label: "Choose several", onPress: () => setPicked([]) }]} />}
      footer={picked ? <><Button style={{ flex: 1 }} kind="secondary" label="Cancel" onPress={() => setPicked(null)} /><Button style={{ flex: 1 }} icon="layers" label="Make a collection" disabled={!picked.length} onPress={() => void make()} /></> : undefined}>
      <Grid
        head={<>
          {!holder && !picked && <View style={s.bar}><Seg block options={[{ id: "photos", label: "All photos", icon: "image" }, { id: "folders", label: "Folders", icon: "folder" }]} value={mode} onChange={(v) => view.set(v)} accessibilityLabel="Show" /></View>}
          {folders.map((f) => <ListRow key={f.id} icon="folder" title={f.name} meta={`${lib.photos.filter((p) => photoFolder(p) === f.id).length} photos`} onPress={() => open({ kind: "folder", id: f.id })} />)}
          {byFolder && !inColl && folders.length > 0 && (stacks.length || loose.length) ? <Block><SectionLabel>{holder ? "In this folder" : "At the top level"}</SectionLabel></Block> : null}
        </>}
        stacks={stacks} photos={loose} holders={lib.holders} picked={picked} refresh={refresh}
        canvases={picked || inColl ? [] : canvases.filter((c) => (byFolder ? c.container === level : true))} onCanvas={(c) => open({ kind: "canvas", id: c.id })}
        onPhoto={(p) => (picked ? setPicked(picked.includes(p.id) ? picked.filter((x) => x !== p.id) : [...picked, p.id]) : open({ kind: "photo", id: p.id }))}
        onStack={(c) => open({ kind: "collection", id: c.id })}
        empty={<Empty icon="image" title={holder ? "Nothing in here yet" : "No photos yet"} body={holder ? undefined : "Take one with the camera, or import pictures from the phone with the download button."} />}
      />
    </Screen>
  );
}

type Item = { kind: "stack"; c: Holder; list: MediaPhoto[] } | { kind: "photo"; p: MediaPhoto } | { kind: "canvas"; v: MediaCanvas };

function Grid({ head, stacks, photos, canvases, holders, picked, refresh, onPhoto, onStack, onCanvas, empty }: { head: ReactNode; stacks: { c: Holder; list: MediaPhoto[] }[]; photos: MediaPhoto[]; canvases: MediaCanvas[]; holders: Holder[]; picked: string[] | null; refresh: ReturnType<typeof useRefreshControl>; onPhoto: (p: MediaPhoto) => void; onStack: (c: Holder) => void; onCanvas: (c: MediaCanvas) => void; empty: ReactNode }) {
  const { width } = useWindowDimensions();
  const cols = Math.max(3, Math.floor(width / 132));
  const items: Item[] = useMemo(() => [...stacks.map((x) => ({ kind: "stack" as const, ...x })), ...canvases.map((v) => ({ kind: "canvas" as const, v })), ...photos.slice().reverse().map((p) => ({ kind: "photo" as const, p }))], [stacks, photos, canvases]);
  return (
    <FlatList key={cols} data={items} numColumns={cols} refreshControl={refresh}
      keyExtractor={(it) => (it.kind === "stack" ? `c-${it.c.id}` : it.kind === "canvas" ? `v-${it.v.id}` : it.p.id)}
      ListHeaderComponent={<>{head}</>}
      ListEmptyComponent={<>{empty}</>}
      contentContainerStyle={{ paddingBottom: 24 }}
      columnWrapperStyle={{ gap: 2, paddingHorizontal: 2 }}
      ItemSeparatorComponent={() => <View style={{ height: 2 }} />}
      renderItem={({ item }) => <View style={{ flex: 1 / cols, aspectRatio: 1 }}>
        {item.kind === "stack" ? <StackTile c={item.c} list={item.list} onPress={() => onStack(item.c)} /> : item.kind === "canvas" ? <CanvasTile v={item.v} onPress={() => onCanvas(item.v)} /> : <PhotoTile p={item.p} coll={holders.find((h) => h.id === item.p.container && h.type === "collection") ?? null} chosen={picked?.includes(item.p.id) ?? null} onPress={() => onPhoto(item.p)} />}
      </View>}
    />
  );
}

const thumbOf = (p: MediaPhoto) => (p.queued?.uri ? { uri: p.queued.uri } : imageSource(p.id, "thumbnail"));

function PhotoTile({ p, coll, chosen, onPress }: { p: MediaPhoto; coll: Holder | null; chosen: boolean | null; onPress: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const prefs = usePrefs();
  const color = coll ? catColor(c, coll.color) : null;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${p.name}${coll ? `, in ${coll.name}` : ""}${p.queued ? `, ${STATE[p.queued.state]}` : ""}`} style={[s.tile, chosen && { borderColor: c.accent, borderWidth: 3 }]}>
      <Image source={thumbOf(p)} style={s.fill} contentFit="cover" recyclingKey={p.id} cachePolicy="disk" />
      {color && <Mark mark={prefs.collectionMark} color={color} />}
      {p.queued && <View style={[s.badge, p.queued.state === "stuck" && { backgroundColor: FIXED.record }]}><Icon name={p.queued.state === "stuck" ? "warning" : p.queued.state === "preview" ? "cloud-upload" : "clock"} size={14} color={FIXED.white} /></View>}
      {chosen !== null && <View style={[s.tick, chosen && { backgroundColor: c.accent, borderColor: c.accent }]}>{chosen && <Icon name="check" size={14} color={c.onAccent} />}</View>}
    </Pressable>
  );
}

/** A canvas: its thumbnail (cropped to its picture), with a brush to tell it from a photo. */
export function CanvasTile({ v, onPress }: { v: MediaCanvas; onPress: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const [none, setNone] = useState(false);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Canvas ${v.name}`} style={s.tile}>
      {none ? <View style={[s.fill, { alignItems: "center", justifyContent: "center" }]}><Icon name="brush" size={28} color={c.textDim} /></View>
        : <Image source={{ uri: canvasImageUrl(v.file, "thumbnail"), headers: authHeaders() }} style={s.fill} contentFit="cover" recyclingKey={v.id} cachePolicy="disk" onError={() => setNone(true)} />}
      <View style={s.nameBar}><Icon name="brush" size={14} color={FIXED.white} /><Text style={s.nameText} numberOfLines={1}>{v.name}</Text></View>
    </Pressable>
  );
}

/** How a photo shows its collection: a bar below or at the left, a dot, or a frame (the account's preference). */
function Mark({ mark, color }: { mark: Prefs["collectionMark"]; color: string }) {
  const st = mark === "bar" ? { left: 0, right: 0, bottom: 0, height: 5 } : mark === "barleft" ? { left: 0, top: 0, bottom: 0, width: 5 } : mark === "dot" ? { right: 6, bottom: 6, width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: FIXED.white } : null;
  return st ? <View pointerEvents="none" style={[{ position: "absolute", backgroundColor: color }, st]} /> : <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderWidth: 4, borderColor: color }} />;
}

function StackTile({ c: coll, list, onPress }: { c: Holder; list: MediaPhoto[]; onPress: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const color = catColor(c, coll.color);
  const cover = list[0];
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Collection ${coll.name}, ${list.length} photos`} style={[s.tile, { borderColor: color, borderWidth: 3 }]}>
      <Image source={thumbOf(cover)} style={s.fill} contentFit="cover" recyclingKey={cover.id} cachePolicy="disk" />
      <View style={[s.count, { backgroundColor: color }]}><Text style={s.countText}>{list.length}</Text></View>
      <View style={s.nameBar}><Icon name="layers" size={14} color={FIXED.white} /><Text style={s.nameText} numberOfLines={1}>{coll.name}</Text></View>
    </Pressable>
  );
}

const STATE = { waiting: "waiting to upload", preview: "preview sent, the original waits", stuck: "stuck: the server refused it" } as const;
const aovText = (a: { horizontal: number; vertical: number } | null | undefined) => (a ? `${Math.round(a.horizontal)}° × ${Math.round(a.vertical)}°` : null);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : null);

function PhotoPage({ photo: p, holders, back }: { photo: MediaPhoto; holders: Holder[]; back: () => void }) {
  const s = useStyles();
  const { width, height } = useWindowDimensions();
  const dev = device.use();
  const q = queue.use().find((x) => x.id === p.id) ?? null;
  const [name, setName] = useState(p.name);
  const [readout, setReadout] = useState<Record<string, string> | null>(q ? (q.meta.readout ?? null) : null);
  const [sheet, setSheet] = useState(false);
  useEffect(() => setName(p.name), [p.name]);
  useEffect(() => { if (!q) photoFile(p.id).then((f) => setReadout((f.body?.readout as Record<string, string> | undefined) ?? null), () => {}); }, [p.id, !q]);
  const coll = holders.find((h) => h.id === p.container && h.type === "collection") ?? null;
  const folderId = coll ? coll.container : p.container;
  const folder = holders.find((h) => h.id === folderId) ?? null;
  const colls = holders.filter((h) => h.type === "collection");
  const preview = q ? { uri: queuedUri(q, "preview") ?? "" } : imageSource(p.id, "preview");
  const devName = p.photo?.device_id ? (p.photo.device_id === dev.file?.id ? `${dev.file.name} (this device)` : "Another device") : q?.meta.device_id ? dev.file?.name ?? "This device" : p.photo?.origin === "import" || q?.meta.origin === "import" ? "None (imported)" : null;
  const bin = async () => {
    if (q && q.step === "meta") {
      if (!(await confirm({ title: "Throw this photo away?", body: "It is not on the server yet: it is deleted from this device for good.", confirmLabel: "Delete", danger: true, icon: "trash" }))) return;
      discard(p.id); back(); return;
    }
    try { await binPhoto(p.id); toast("In the recycle bin"); back(); } catch (e) { toast(`Not moved: ${(e as Error).message}`, "danger"); }
  };
  const place = async (container: string | null) => { setSheet(false); try { await placePhotos([p.id], container); } catch (e) { toast(`Not moved: ${(e as Error).message}`, "danger"); } };
  return (
    <Screen header={<Header title={p.name} sub={p.queued ? STATE[p.queued.state] : when(p.taken) ?? undefined} onBack={back} actions={[{ icon: "trash", label: "Move to the bin", onPress: () => void bin() }]} />}
      footer={<Button style={{ flex: 1 }} kind="secondary" icon="layers" label={coll ? `Collection: ${coll.name}` : "Add to a collection"} onPress={() => setSheet(true)} />}>
      <View style={[s.pic, { height: Math.min(height * 0.5, width * 0.9) }]}><Image source={preview} style={s.fill} contentFit="contain" cachePolicy="disk" /></View>
      {p.queued?.state === "stuck" && <Block><Banner kind="danger" title="The server refused this photo" meta={`${p.queued.error ?? ""} It stays on this device until it is sent or discarded.`}
        action={<View style={{ flexDirection: "row", gap: 8 }}><Button kind="secondary" label="Retry" onPress={() => retry(p.id)} /><Button kind="danger" label="Discard" onPress={() => void confirm({ title: "Discard this photo?", body: "It is deleted from this device for good.", confirmLabel: "Discard", danger: true, icon: "trash" }).then((ok) => { if (ok === true) { discard(p.id); back(); } })} /></View>} /></Block>}
      <Block>
        <SectionLabel>Name</SectionLabel>
        <TextInput value={name} onChangeText={setName} onEndEditing={() => { if (name.trim() && name !== p.name) void renamePhoto(p.id, name).catch((e) => toast(`Not renamed: ${(e as Error).message}`, "danger")); }} style={s.input} returnKeyType="done" />
      </Block>
      <Block><SectionLabel>Photo facts</SectionLabel></Block>
      <FieldRow label="Taken" value={when(p.taken)} placeholder="Not known" />
      <FieldRow label="Size" value={p.width && p.height ? `${p.width} × ${p.height}` : null} />
      <FieldRow label="Lens" value={[readout?.make, readout?.model, readout?.lens].filter(Boolean).join(" · ") || null} placeholder="Not reported" />
      <FieldRow label="Angle of view" value={aovText(p.photo?.angle_of_view)} placeholder={q ? "Computed by the server" : "None: the photo reports no focal length"} />
      {devName && <FieldRow label="Device" value={devName} />}
      <Block><SectionLabel>Where it is</SectionLabel></Block>
      <FieldRow label="Folder" value={folder?.name ?? "Top level of the project"} />
      <FieldRow label="Collection" value={coll?.name ?? "None"} />
      <PhotoProperties fileId={p.id} type="photo" />
      <Sheet visible={sheet} title="Collection" onClose={() => setSheet(false)} doneLabel={null}>
        {coll && <ListRow icon="close" title="Take out of its collection" trailing={null} onPress={() => void place(folderId ?? null)} />}
        {colls.filter((c) => c.id !== coll?.id).map((c) => <CollRow key={c.id} c={c} onPress={() => void place(c.id)} />)}
        {!colls.length && <Hint>No collections yet: choose photos in Media with the tick to make one.</Hint>}
      </Sheet>
    </Screen>
  );
}

function CollRow({ c: coll, onPress }: { c: Holder; onPress: () => void }) {
  const { c } = useTheme();
  return <ListRow title={coll.name} trailing={<View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: catColor(c, coll.color) }} />} onPress={onPress} />;
}

const useStyles = makeStyles((c) => ({
  bar: { paddingHorizontal: 12, paddingVertical: 8 },
  tile: { flex: 1, overflow: "hidden", backgroundColor: c.surfaceSunken, borderColor: "transparent" },
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  badge: { position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: FIXED.glass, alignItems: "center", justifyContent: "center" },
  tick: { position: "absolute", top: 6, left: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: FIXED.white, backgroundColor: FIXED.glass, alignItems: "center", justifyContent: "center" },
  count: { position: "absolute", top: 4, right: 4, minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  countText: { ...type("caption", "heavy"), color: FIXED.white, ...num },
  nameBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 4, backgroundColor: FIXED.glass },
  nameText: { ...type("caption", "bold"), color: FIXED.white, flexShrink: 1 },
  pic: { backgroundColor: FIXED.photoBg },
  input: { ...type("body"), minHeight: 52, backgroundColor: c.surface, color: c.text, borderWidth: 2, borderColor: c.border, borderRadius: RADIUS.sm, paddingHorizontal: 14 },
}));

registerApp({ id: "media", label: "Media", icon: "image", needsProject: true, Screen: Media });
