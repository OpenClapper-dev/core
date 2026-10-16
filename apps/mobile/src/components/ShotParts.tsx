import { useEffect, useState } from "react";
import { Modal, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { label } from "@fielder/vocab";
import { api, positionOf, type Photo, type Shot } from "../api";
import { editShot, isWaiting } from "../localShots";
import { isOfflineMode, isOnline } from "../net";
import { discardPending } from "../uploads";
import { useApp } from "../appState";
import type { ViewSettings } from "../types";
import { extraLine, placeLabel, rigLabel, shortTime, shotTitle, tagsLabel } from "../shots";
import { BORDER, confirm, FIXED, IconButton, ListRow, makeStyles, notice, num, PhotoTag, RADIUS, SeqBadge, Sheet, SheetList, StateMarker, toast, type, useTheme } from "../ui";
import { useSwipe } from "./gestures";
import { fitWidth, FrameModeSeg, ShotFrame, type FrameMode } from "./ShotFrame";

const PAST: Record<Shot["state"], string> = { approved: "Approved", archived: "Archived", unreviewed: "Back to review" };

/** The two state actions that aren't the current state (Shot details, History). */
export function stateActions(state: Shot["state"]): { state: Shot["state"]; label: string; icon: string; kind: "approve" | "archive" }[] {
  const back = { state: "unreviewed" as const, label: "Back to review", icon: "undo", kind: "archive" as const };
  const approve = { state: "approved" as const, label: "Approve", icon: "check", kind: "approve" as const };
  const archive = { state: "archived" as const, label: "Archive", icon: "archive-outline", kind: "archive" as const };
  return state === "unreviewed" ? [archive, approve] : state === "approved" ? [back, archive] : [back, approve];
}

/**
 * Review decisions and deletes, the same everywhere: a toast with Undo. Works offline and on
 * queued shots too (editShot keeps the change on the phone until it can be sent).
 */
export function useShotActions() {
  const app = useApp();
  const setState = async (shot: Shot, state: Shot["state"]) => {
    const before = shot.state;
    try {
      const updated = await editShot(shot, { state });
      app.shots.update(updated);
      const where = updated.queued ? " · uploads with the shot" : isWaiting(shot.id) ? " · syncs when online" : "";
      toast(PAST[state] + where, "ok", { label: "Undo", run: () => { void editShot(updated, { state: before }).then(app.shots.update).catch((e) => notice("Undo failed", String(e))); } });
    } catch (e) {
      void notice("Not saved", `${e instanceof Error ? e.message : String(e)}. The shot keeps its state.`);
    }
  };
  /** Resolves true when the shot is gone. Archive is offered as the safe alternative. */
  const remove = async (shot: Shot): Promise<boolean> => {
    if (shot.queued) {
      const r = await confirm({ title: "Discard this shot?", body: `It is not uploaded yet: the ${shot.photos.length === 1 ? "photo is" : `${shot.photos.length} photos are`} deleted from the phone. Archive keeps it.`, confirmLabel: "Discard", danger: true, altLabel: shot.state === "archived" ? undefined : "Archive" });
      if (r === "alt") { await setState(shot, "archived"); return false; }
      if (r !== true) return false;
      discardPending(shot.id);
      toast("Discarded", "neutral");
      return true;
    }
    if (isOfflineMode() || !isOnline()) { void notice("Delete needs a connection", "Deleting removes the shot from the server. Archive it now, or delete it when you are online."); return false; }
    const r = await confirm({ title: "Delete this shot?", body: "Removes the image and its metadata from the server permanently. Archive keeps them.", confirmLabel: "Delete", danger: true, altLabel: shot.state === "archived" ? undefined : "Archive" });
    if (r === "alt") { await setState(shot, "archived"); return false; }
    if (r !== true) return false;
    try { await api.deleteShot(shot.id); app.shots.remove(shot.id); toast("Shot deleted", "neutral"); return true; }
    catch (e) { void notice("Delete failed", e instanceof Error ? e.message : String(e)); return false; }
  };
  return { setState, remove };
}

/** ⋯ on a shot: details, map, position, delete (separated at the bottom). */
export function MoreSheet({ shot, photo, visible, onClose, onDeleted, details = true }: { shot: Shot; photo: Photo; visible: boolean; onClose: () => void; onDeleted?: () => void; details?: boolean }) {
  const app = useApp();
  const { c } = useTheme();
  const { remove } = useShotActions();
  const list = app.shots.shots?.map((s) => s.id) ?? [shot.id];
  return (
    <Sheet visible={visible} title={shotTitle(shot)} onClose={onClose}>
      <SheetList>
        {details && <ListRow icon="information-outline" title="Shot details" onPress={() => { onClose(); app.push({ name: "shot", shotId: shot.id, list }); }} />}
        <ListRow icon="map-marker-outline" title="Show on map" meta={positionOf(shot) ? undefined : "No position yet"} disabled={!positionOf(shot)} onPress={() => { onClose(); app.push({ name: "mapFocus", shotId: shot.id }); }} />
        <ListRow icon="crosshairs-gps" title={photo.lat === null ? "Set position" : "Correct position"} meta={shot.photos.length > 1 ? "Of the photo on screen, or all of them" : undefined} onPress={() => { onClose(); app.push({ name: "position", shotId: shot.id, photoId: photo.id }); }} />
        <View style={{ height: 16 }} />
        <ListRow icon="delete-outline" iconColor={c.danger} titleColor={c.danger} title={shot.queued ? "Discard shot" : "Delete shot"} trailing={null} onPress={() => { onClose(); void remove(shot).then((gone) => { if (gone) onDeleted?.(); }); }} />
      </SheetList>
    </Sheet>
  );
}

/** Title, state + location, tags, extra fields, rig · lens · capture time. */
export function ShotSummary({ shot, photo }: { shot: Shot; photo: Photo }) {
  const s = useStyles();
  const tags = tagsLabel(shot);
  const extra = extraLine(shot);
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.title}>{shotTitle(shot)}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <StateMarker state={shot.state} lg />
        {shot.queued && <PhotoTag icon="cloud-upload-outline">Queued</PhotoTag>}
        <Text style={s.place}>{placeLabel(shot) || (tags ? "No location" : "No location · untagged")}</Text>
      </View>
      {!!tags && <Text style={s.line}>{tags}</Text>}
      {!!extra && <Text style={s.dim}>{extra}</Text>}
      <Text style={[s.dim, num]}>{rigLabel(photo)} · {shortTime(photo.timestamp)}</Text>
    </View>
  );
}

/**
 * A stored shot's photo with its badges (SEQ top-left, "Photo i / n" top-right). Swipe moves
 * between shots, the strip between photos; double-tap opens the full-screen photo.
 */
export function ShotPhoto({ shot, index, mode, settings, maxW, maxH, onNext, onPrev, onOpen }: { shot: Shot; index: number; mode: FrameMode; settings: ViewSettings; maxW: number; maxH: number; onNext?: () => void; onPrev?: () => void; onOpen?: () => void }) {
  const s = useStyles();
  const photo = shot.photos[Math.min(index, shot.photos.length - 1)];
  const pan = useSwipe({ width: maxW, next: onNext, prev: onPrev, doubleTap: onOpen });
  return (
    <View style={[s.photoBox, { width: maxW, height: maxH }]} {...pan}>
      <ShotFrame photo={photo} width={fitWidth(photo, mode, maxW, maxH)} settings={settings} mode={mode} />
      {shot.photos.length > 1 && <View style={s.tl} pointerEvents="none"><SeqBadge count={shot.photos.length} /></View>}
      {shot.photos.length > 1 && <View style={s.tr} pointerEvents="none"><PhotoTag>Photo {Math.min(index, shot.photos.length - 1) + 1} / {shot.photos.length}</PhotoTag></View>}
    </View>
  );
}

/** Double-tap: the photo on black, as large as it goes, the mode switch on an opaque card; swipe = photos. */
export function FullPhoto({ shot, index, mode, onMode, settings, onClose }: { shot: Shot; index: number; mode: FrameMode; onMode: (m: FrameMode) => void; settings: ViewSettings; onClose: () => void }) {
  const s = useStyles();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(index);
  useEffect(() => setI(index), [index]);
  const n = shot.photos.length;
  const photo = shot.photos[Math.min(i, n - 1)];
  const pan = useSwipe({ width, next: () => setI((x) => Math.min(n - 1, x + 1)), prev: () => setI((x) => Math.max(0, x - 1)) });
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={s.full} {...pan}>
        <ShotFrame photo={photo} width={fitWidth(photo, mode, width, height - 140)} settings={settings} mode={mode} />
        <View style={[s.fullClose, { top: insets.top + 12 }]}><IconButton icon="close" label="Close" size={52} onPress={onClose} /></View>
        <View style={[s.fullCard, { bottom: Math.max(insets.bottom, 32) }]}>
          <FrameModeSeg value={mode} onChange={onMode} />
          <Text style={s.fullText}>{n > 1 ? `Photo ${Math.min(i, n - 1) + 1} / ${n} · swipe for photos` : label(shot.state)}</Text>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  title: { ...type("heading", "bold"), fontSize: 22, lineHeight: 28, color: c.text },
  place: { ...type("body", "semibold"), color: c.text, flexShrink: 1 },
  line: { ...type("body"), color: c.text },
  dim: { ...type("small"), color: c.textDim },
  photoBox: { backgroundColor: FIXED.photoBg, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  tl: { position: "absolute", top: 10, left: 10 },
  tr: { position: "absolute", top: 10, right: 10 },
  full: { flex: 1, backgroundColor: FIXED.photoBg, alignItems: "center", justifyContent: "center" },
  fullClose: { position: "absolute", left: 12 },
  fullCard: { position: "absolute", alignSelf: "center", alignItems: "center", gap: 6, padding: 10, borderRadius: RADIUS.md, backgroundColor: c.chromeBg, borderWidth: BORDER.badge, borderColor: c.chromeBorder },
  fullText: { ...type("small", "bold"), color: c.chromeText, ...num },
}));

