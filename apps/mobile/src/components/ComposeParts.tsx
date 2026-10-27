import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Image, type ImageSource } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sketchKindLabel } from "@openclapper/vocab";
import { imageHeaders, renderUri, type Composed, type Photo, type Shot } from "../api";
import { isOfflineMode } from "../net";
import { offlineRenderUri } from "../offline";
import type { ViewSettings } from "../types";
import { BORDER, FIXED, Icon, IconButton, ListRow, makeStyles, RADIUS, SectionLabel, type } from "../ui";
import { MarkdownText } from "./Markdown";

/**
 * Sketches on the phone (issue #12): read-only renders made in the Studio, shown as they are.
 * Offline copies are used when present. Layers are not here: a step's bake carries them.
 */

/** Image source of a render: the offline copy, else the authenticated proxy (nothing in offline mode). */
export function renderSource(item: { id: string; render_url: string | null }): ImageSource {
  const local = offlineRenderUri(item);
  if (local) return { uri: local };
  const uri = renderUri(item);
  return isOfflineMode() || !uri ? { uri: "" } : { uri, headers: imageHeaders() };
}

export const composedOf = (shot: Shot, _photo: Photo): Composed[] => shot.sketches.map((s): Composed => ({ type: "sketch", ...s }));

/** Thumbnails of the shot's sketches; nothing when the shot has none. */
export function ComposeStrip({ shot, photo, onOpen }: { shot: Shot; photo: Photo; onOpen: (c: Composed) => void }) {
  const s = useStyles();
  const items = composedOf(shot, photo);
  if (!items.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ paddingHorizontal: 16 }}><SectionLabel>Sketches</SectionLabel></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16, paddingVertical: 4 }}>
        {items.map((it) => (
          <Pressable key={it.id} onPress={() => onOpen(it)} style={({ pressed }) => [s.tile, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`${it.name}, ${kindLabel(it)}`}>
            <View style={[s.thumb, { backgroundColor: FIXED.white }]}>
              {it.render_url ? <Image source={renderSource(it)} style={{ width: "100%", height: "100%" }} contentFit="contain" cachePolicy="disk" /> : <Icon name="floor-plan" color={FIXED.photoBg} />}
            </View>
            <Text style={s.tileName} numberOfLines={1}>{it.name}</Text>
            <Text style={s.tileMeta} numberOfLines={1}>{kindLabel(it)}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export const kindLabel = (c: Composed) => sketchKindLabel(c.kind) || "Sketch";

/** Rows for a sheet (step-through Details). */
export function ComposeRows({ shot, photo, onOpen }: { shot: Shot; photo: Photo; onOpen: (c: Composed) => void }) {
  const items = composedOf(shot, photo);
  if (!items.length) return null;
  return <View style={{ marginHorizontal: -16 }}>{items.map((it) => <ListRow key={it.id} icon="floor-plan" title={it.name} meta={[kindLabel(it), it.description ? "has notes" : null].filter(Boolean).join(" · ")} onPress={() => onOpen(it)} />)}</View>;
}

/** Full screen: the sketch on white, the name and kind, and the description on an opaque card. */
export function ComposeViewer({ item, onClose }: { item: Composed; photo?: Photo; settings?: ViewSettings; onClose: () => void }) {
  const s = useStyles();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState(true);
  const landscape = width > height;
  const imgMaxH = height - (landscape ? 110 : 220);
  const source = renderSource(item);
  const w = Math.max(40, Math.min(width, imgMaxH * item.aspect));
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={s.full}>
        {<View style={{ width: w, height: w / item.aspect, backgroundColor: FIXED.white }}>{item.render_url ? <Image source={source} style={{ width: "100%", height: "100%" }} contentFit="contain" /> : <View style={s.noRender}><Icon name="image-off-outline" color={FIXED.white} /><Text style={s.noRenderText}>No render yet</Text></View>}</View>}
        <View style={[s.close, { top: insets.top + 12 }]}><IconButton icon="close" label="Close" size={52} onPress={onClose} /></View>
        <View style={[s.card, { bottom: Math.max(insets.bottom, 24), maxWidth: Math.min(width - 24, 560) }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>{item.name}</Text>
              <Text style={s.meta} numberOfLines={1}>{kindLabel(item)}</Text>
            </View>
            {!!item.description && <IconButton icon={notes ? "chevron-down" : "text-long"} label={notes ? "Hide notes" : "Show notes"} onPress={() => setNotes(!notes)} />}
          </View>
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
