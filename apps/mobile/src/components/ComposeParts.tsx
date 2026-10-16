import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Image, type ImageSource } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { referencedFrame, sketchKindLabel } from "@fielder/vocab";
import { imageHeaders, renderUri, type Composed, type Overlay, type Photo, type Shot, type Sketch } from "../api";
import { isOfflineMode } from "../net";
import { offlineRenderUri } from "../offline";
import type { ViewSettings } from "../types";
import { BORDER, FIXED, Icon, IconButton, ListRow, makeStyles, RADIUS, SectionLabel, type, useTheme } from "../ui";
import { FramedImage } from "./FramedImage";
import { fitWidth, FrameModeSeg, frameOf, imageAspect, type FrameMode } from "./ShotFrame";
import { MarkdownText } from "./Markdown";

/**
 * Overlays and sketches on the phone (issue #12): read-only renders made on the dashboard. An
 * overlay render is the photo's size, so it takes the frame modes like the photo (opening in the
 * presentation it was drawn in); a sketch is shown as is. Offline copies are used when present.
 */

/** Image source of a render: the offline copy, else the authenticated proxy (nothing in offline mode). */
export function renderSource(item: { id: string; render_url: string | null }): ImageSource {
  const local = offlineRenderUri(item);
  if (local) return { uri: local };
  const uri = renderUri(item);
  return isOfflineMode() || !uri ? { uri: "" } : { uri, headers: imageHeaders() };
}

export const composedOf = (shot: Shot, photo: Photo): Composed[] => [
  ...shot.overlays.filter((o) => o.photo_id === photo.id).map((o): Composed => ({ type: "overlay", ...o })),
  ...shot.sketches.map((s): Composed => ({ type: "sketch", ...s })),
];

/** Thumbnails of the photo's overlays and the shot's sketches; nothing when the shot has none. */
export function ComposeStrip({ shot, photo, onOpen }: { shot: Shot; photo: Photo; onOpen: (c: Composed) => void }) {
  const s = useStyles();
  const items = composedOf(shot, photo);
  if (!items.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ paddingHorizontal: 16 }}><SectionLabel>{shot.photos.length > 1 ? `Overlays · photo ${photo.ordinal + 1} · Sketches` : "Overlays · Sketches"}</SectionLabel></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16, paddingVertical: 4 }}>
        {items.map((it) => (
          <Pressable key={it.id} onPress={() => onOpen(it)} style={({ pressed }) => [s.tile, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`${it.name}, ${kindLabel(it)}`}>
            <View style={[s.thumb, it.type === "sketch" && { backgroundColor: FIXED.white }]}>
              {it.render_url ? <Image source={renderSource(it)} style={{ width: "100%", height: "100%" }} contentFit={it.type === "sketch" ? "contain" : "cover"} cachePolicy="disk" /> : <Icon name={it.type === "overlay" ? "layers-outline" : "floor-plan"} color={FIXED.white} />}
            </View>
            <Text style={s.tileName} numberOfLines={1}>{it.name}</Text>
            <Text style={s.tileMeta} numberOfLines={1}>{kindLabel(it)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export const kindLabel = (c: Composed) => (c.type === "overlay" ? "Overlay" : sketchKindLabel(c.kind) || "Sketch");

/** Rows for a sheet (step-through Details). */
export function ComposeRows({ shot, photo, onOpen }: { shot: Shot; photo: Photo; onOpen: (c: Composed) => void }) {
  const items = composedOf(shot, photo);
  if (!items.length) return null;
  return <View style={{ marginHorizontal: -16 }}>{items.map((it) => <ListRow key={it.id} icon={it.type === "overlay" ? "layers-outline" : "floor-plan"} title={it.name} meta={[kindLabel(it), it.description ? "has notes" : null].filter(Boolean).join(" · ")} onPress={() => onOpen(it)} />)}</View>;
}

/**
 * Full screen: the render on black (overlays with the frame modes, opening in the presentation they
 * were drawn in), the name and kind, and the description on an opaque card.
 */
export function ComposeViewer({ item, photo, settings, onClose }: { item: Composed; photo: Photo; settings: ViewSettings; onClose: () => void }) {
  const s = useStyles();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const overlay = item.type === "overlay" ? (item as Overlay) : null;
  const [mode, setMode] = useState<FrameMode>(overlay?.presentation.mode ?? "off");
  const [notes, setNotes] = useState(true);
  const landscape = width > height;
  const imgMaxH = height - (landscape ? 110 : 220);
  const source = renderSource(item);
  // The framing the overlay references (follows its edits), else the frame it kept, else the photo's root.
  const ref = overlay ? referencedFrame({ framings: photo.framings }, overlay.presentation) : null;
  const frame = overlay ? (ref ? { width: ref.width_fraction, height: ref.height_fraction, x: ref.x, y: ref.y } : frameOf(photo)) : null;
  const w = overlay
    ? fitWidth({ ...photo, framings: [], root_framing_id: null, framing: frame ? { ...(photo.framing ?? {}), frame: { width_fraction: frame.width, height_fraction: frame.height } } : photo.framing }, mode, width, imgMaxH)
    : Math.max(40, Math.min(width, imgMaxH * (item as Sketch).aspect));
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={s.full}>
        {overlay
          ? <FramedImage source={source} aspect={imageAspect(photo)} frame={frame} width={w} settings={settings} mode={mode} />
          : <View style={{ width: w, height: w / (item as Sketch).aspect, backgroundColor: FIXED.white }}>{item.render_url ? <Image source={source} style={{ width: "100%", height: "100%" }} contentFit="contain" /> : <View style={s.noRender}><Icon name="image-off-outline" color={FIXED.white} /><Text style={s.noRenderText}>No render yet</Text></View>}</View>}
        <View style={[s.close, { top: insets.top + 12 }]}><IconButton icon="close" label="Close" size={52} onPress={onClose} /></View>
        <View style={[s.card, { bottom: Math.max(insets.bottom, 24), maxWidth: Math.min(width - 24, 560) }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>{item.name}</Text>
              <Text style={s.meta} numberOfLines={1}>{kindLabel(item)}{overlay?.presentation.label ? ` · ${overlay.presentation.label}` : ""}</Text>
            </View>
            {!!item.description && <IconButton icon={notes ? "chevron-down" : "text-long"} label={notes ? "Hide notes" : "Show notes"} onPress={() => setNotes(!notes)} />}
          </View>
          {overlay && <FrameModeSeg value={mode} onChange={setMode} />}
          {!!item.description && notes && <ScrollView style={{ maxHeight: landscape ? 90 : 160 }}><MarkdownText source={item.description} /></ScrollView>}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  tile: { width: 120, gap: 3 },
  thumb: { width: 120, height: 80, borderRadius: RADIUS.sm, overflow: "hidden", backgroundColor: FIXED.photoBg, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  tileName: { ...type("small", "bold"), color: c.text },
  tileMeta: { ...type("caption"), color: c.textDim },
  full: { flex: 1, backgroundColor: FIXED.photoBg, alignItems: "center", justifyContent: "center" },
  close: { position: "absolute", left: 12 },
  card: { position: "absolute", alignSelf: "center", gap: 8, padding: 12, borderRadius: RADIUS.md, backgroundColor: c.chromeBg, borderWidth: BORDER.badge, borderColor: c.chromeBorder, width: "100%" },
  name: { ...type("body", "bold"), color: c.chromeText },
  meta: { ...type("caption"), color: c.textDim },
  noRender: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: FIXED.photoBg },
  noRenderText: { ...type("small", "bold"), color: FIXED.white },
}));
