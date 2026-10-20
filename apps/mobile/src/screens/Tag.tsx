import { useEffect, useMemo, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pruneExtra, type FieldDef } from "@openclapper/vocab";
import { hhmm } from "../shots";
import { store } from "../storage";
import type { CaptureDraft, LocationEntry, ProjectEntry, ShotTags, SpotEntry, ViewSettings } from "../types";
import { ActionBar, BORDER, Button, confirm, FIXED, makeStyles, num, RADIUS, SeqBadge, SIZE, type } from "../ui";
import { FramedImage } from "../components/FramedImage";
import { EMPTY_TAGS, TagEditor, type TagDraft } from "../components/TagEditor";

interface Props {
  draft: CaptureDraft;
  settings: ViewSettings;
  project: ProjectEntry | null;
  locations: LocationEntry[];
  spots: SpotEntry[];
  countAt: (locationId: string) => number;
  fields: readonly FieldDef[];
  onUpload: (tags: ShotTags, newLocation: LocationEntry | null, newSpot: SpotEntry | null) => void;
  onDiscard: () => void;
}

/** Tags of the last upload (never the name; location, spot and extra fields only within the same project) and which keys they filled. */
function remembered(projectId: string | null): { tags: ShotTags; keys: Set<string> } {
  const last = store.loadLastTags();
  if (!last) return { tags: EMPTY_TAGS, keys: new Set() };
  const t = last.tags;
  const sameProject = last.projectId === projectId;
  const known = !t.location_id || store.loadLocations().some((l) => l.id === t.location_id && l.projectId === projectId);
  const spotKnown = known && !!t.spot_id && store.loadSpots().some((x) => x.id === t.spot_id && x.locationId === t.location_id);
  const tags: ShotTags = { ...EMPTY_TAGS, ...t, name: null, location_id: known ? t.location_id : null, spot_id: spotKnown ? t.spot_id : null, extra: sameProject ? t.extra ?? {} : {} };
  const keys = new Set<string>();
  if (tags.location_id) keys.add("location_id");
  if (tags.spot_id) keys.add("spot_id");
  if (tags.int_ext) keys.add("int_ext");
  if (tags.light.length || tags.artificial) keys.add("light");
  if (tags.weather) keys.add("weather");
  if (tags.camera_support) keys.add("camera_support");
  for (const k of Object.keys(tags.extra)) keys.add(`extra.${k}`);
  return { tags, keys };
}

/**
 * After every capture (unless Direct upload is on): the photo, the remembered tags marked LAST,
 * and Discard | Upload pinned at the thumb. A repeat shot is one tap on Upload. The draft is
 * persisted, so this reopens after the app was killed. Android back asks before discarding.
 */
export function Tag({ draft, settings, project, locations, spots, countAt, fields, onUpload, onDiscard }: Props) {
  const s = useStyles();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const portrait = height >= width;
  const start = useMemo(() => remembered(project?.id ?? null), [draft.shotId]);
  const [value, setValue] = useState<TagDraft>({ tags: start.tags, newLocation: null, newSpot: null });
  const [keys, setKeys] = useState<Set<string>>(start.keys);
  const [index, setIndex] = useState(0);
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener("keyboardDidShow", () => setKeyboard(true));
    const b = Keyboard.addListener("keyboardDidHide", () => setKeyboard(false));
    return () => { a.remove(); b.remove(); };
  }, []);

  const n = draft.photos.length;
  const seq = n > 1;
  const current = draft.photos[Math.min(index, n - 1)];
  const m = current.meta;
  const facts = [hhmm(m.timestamp), `${m.lens_mm} mm`, m.lat === null ? "no position" : m.gps_accuracy_m != null ? `GPS ±${Math.round(m.gps_accuracy_m)} m` : "no GPS accuracy"].join(" · ");

  const upload = () => {
    const tags = { ...value.tags, name: value.tags.name?.trim() || null, extra: pruneExtra(value.tags.extra) };
    if (project) store.saveLastTags({ projectId: project.id, tags: { light: tags.light, artificial: tags.artificial, weather: tags.weather, int_ext: tags.int_ext, location_id: tags.location_id, spot_id: tags.spot_id, extra: tags.extra,
      // The support usually stays for a while (a Steadicam day); size and movement change shot to shot.
      camera_support: tags.camera_support, shot_size: null, movement: [] } });
    onUpload(tags, value.newLocation, value.newSpot);
  };
  const discard = async () => {
    const ok = await confirm({
      title: seq ? "Discard this sequence?" : "Discard this shot?",
      body: `${seq ? `${n} photos are` : "The photo is"} deleted from the phone. This can't be undone.`,
      confirmLabel: seq ? `Discard ${n}` : "Discard", cancelLabel: "Keep editing", danger: true,
    });
    if (ok === true) onDiscard();
  };

  const photoH = portrait ? (keyboard ? 120 : 208) : height - 64 - 32;
  const photoW = portrait ? width : 300;
  const f = current.frame;
  const fitAspect = (m.width / m.height) * (f.width / f.height);
  const imgW = Math.min(photoW, photoH * fitAspect);
  const photo = (
    <View style={[s.photo, { width: photoW, height: portrait ? photoH : undefined, flex: portrait ? undefined : 1 }]}>
      <FramedImage source={{ uri: current.uri }} aspect={m.width / m.height} frame={f} width={portrait ? imgW : Math.min(photoW, (height - 200) * fitAspect)} settings={settings} mode="fit" />
      {seq && <View style={s.seqBadge}><SeqBadge count={n} /></View>}
      {!portrait && <View style={s.factsCard}><Text style={s.factsText}>{facts}</Text></View>}
    </View>
  );
  const strip = seq && !keyboard && (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.stripWrap} contentContainerStyle={{ gap: 8, padding: 8 }}>
      {draft.photos.map((p, i) => (
        <Pressable key={p.meta.id} onPress={() => setIndex(i)} style={[s.thumb, i === index && s.thumbOn]} accessibilityRole="button" accessibilityLabel={`Photo ${i + 1}`} accessibilityState={{ selected: i === index }}>
          <Image source={{ uri: p.uri }} style={{ width: "100%", height: "100%" }} contentFit="cover" />
        </Pressable>
      ))}
    </ScrollView>
  );
  const editor = (
    <TagEditor value={value} onChange={setValue} projectId={project?.id ?? ""} locations={locations} spots={spots} countAt={countAt} fields={fields} projectName={project?.name}
      remembered={keys} onTouched={(k) => setKeys((cur) => { if (!cur.has(k)) return cur; const nx = new Set(cur); nx.delete(k); return nx; })}
      lastLocationId={store.loadLastTags()?.tags.location_id ?? null} />
  );
  const discardBtn = <Button style={portrait ? { flex: 1 } : undefined} kind="secondary" icon="delete-outline" label={seq ? `Discard ${n}` : "Discard"} onPress={() => void discard()} />;
  const uploadBtn = <Button style={portrait ? { flex: 2 } : { minHeight: 120 }} big={!portrait} icon="cloud-upload-outline" label={seq ? `Upload ${n} photos` : "Upload"} onPress={upload} />;

  return (
    <Modal visible animationType="slide" onRequestClose={() => void discard()} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="height" style={[s.root, { paddingTop: insets.top, paddingLeft: portrait ? 0 : insets.left }]}>
        <View style={s.header}>
          <Text style={s.title} numberOfLines={1}>{seq ? `Tag sequence · ${n} photos` : "Tag shot"}</Text>
          <Text style={s.sub} numberOfLines={1}>{portrait ? facts : project?.name ?? ""}</Text>
        </View>
        {portrait ? (
          <>
            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 16 }}>
              {photo}
              {strip}
              {editor}
            </ScrollView>
            <ActionBar style={{ paddingBottom: keyboard ? 10 : Math.max(SIZE.edgePad, insets.bottom) }}>{discardBtn}{uploadBtn}</ActionBar>
          </>
        ) : (
          <View style={{ flex: 1, flexDirection: "row" }}>
            <View style={{ width: photoW, backgroundColor: FIXED.photoBg }}>{photo}{strip}</View>
            <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>{editor}</ScrollView>
            <ActionBar column style={{ paddingRight: 12 + Math.max(SIZE.edgePad - 12, insets.right), width: SIZE.actionColumn + Math.max(SIZE.edgePad - 12, insets.right) }}>{discardBtn}{uploadBtn}</ActionBar>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  header: { height: SIZE.header, justifyContent: "center", paddingHorizontal: 16, backgroundColor: c.surface, borderBottomWidth: BORDER.control, borderBottomColor: c.borderSubtle },
  title: { ...type("title", "bold"), color: c.text },
  sub: { ...type("small"), color: c.textDim, ...num },
  photo: { backgroundColor: FIXED.photoBg, alignItems: "center", justifyContent: "center" },
  seqBadge: { position: "absolute", top: 10, right: 10 },
  factsCard: { position: "absolute", left: 8, right: 8, bottom: 8, padding: 8, borderRadius: RADIUS.sm, backgroundColor: c.chromeBg, borderWidth: BORDER.badge, borderColor: c.chromeBorder },
  factsText: { ...type("small", "bold"), color: c.chromeText, ...num },
  stripWrap: { flexGrow: 0, backgroundColor: FIXED.photoBg },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.sm, overflow: "hidden", borderWidth: 1, borderColor: c.chromeBorder, backgroundColor: FIXED.photoBg },
  thumbOn: { borderWidth: 3, borderColor: c.accent },
}));
