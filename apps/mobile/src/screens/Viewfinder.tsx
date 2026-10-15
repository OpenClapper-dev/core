import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import * as Crypto from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File } from "expo-file-system";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HUMAN_STEPS } from "../defaults";
import { api } from "../api";
import { useApp } from "../appState";
import { isSignedIn, onAuthChange, signedInEmail } from "../auth";
import { isConfigured } from "../config";
import { computeOverlay, formatDeg, previewBox, type Box } from "../framing";
import { clampToRange } from "../lens";
import { log } from "../log";
import { PHONE } from "../phone";
import { saveRig, syncRigs, useRigs } from "../rigs";
import { addToSequence, deleteDraftFiles, keepPhoto, restoreDraft, startSequence } from "../sequence";
import { store } from "../storage";
import { useSync } from "../sync";
import { lensRangeOf, type CaptureDraft, type DraftPhoto, type LocationEntry, type PhotoMetadata, type SpotEntry, type ShotMetadata, type ShotTags } from "../types";
import { enqueue, flush } from "../uploads";
import { Badge, BORDER, Button, Empty, FIXED, Icon, makeStyles, notice, num, RADIUS, SeqBadge, SIZE, toast, type, useTheme, useToastOffset } from "../ui";
import { HudChip } from "../components/Hud";
import { LensSheet } from "../components/LensSheet";
import { LensStrip } from "../components/LensStrip";
import { HUMAN_COLOR, Overlay } from "../components/Overlay";
import { RigSheet } from "../components/RigSheet";
import { EMPTY_TAGS } from "../components/TagEditor";
import { retryAll } from "./Uploads";
import { Tag } from "./Tag";

/** Portrait chrome block: 10 pad · lens strip 56 · 10 gap · control row 76 · 12 pad, plus the 2 dp top edge. */
const CHROME_H = 10 + 56 + 10 + SIZE.shutter + 12 + 2;
/** Landscape columns: lens strip (after the cutout pad) and the control column next to the tab bar. */
const LENS_COL = 80;
const CONTROL_COL = 80;
const MAX_UPLOAD_EDGE = 1280;
/** A watched GPS fix younger than this is used as is; otherwise the capture waits briefly for a fresh one. */
const FIX_MAX_AGE_MS = 15_000;
/** Low precision accepts the phone's last known position up to this old. */
const LOW_MAX_AGE_MS = 30 * 60_000;

/** A position for a capture; `reused` = taken over from the sequence's first photo. */
interface Fix { lat: number; lon: number; accuracy: number | null; altitude: number | null; heading: number | null; at: number; reused?: boolean }
const toFix = (p: Location.LocationObject | null): Fix | null =>
  p ? { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy ?? null, altitude: p.coords.altitude ?? null, heading: p.coords.heading ?? null, at: p.timestamp } : null;

/** GPS worse than this is a warning. */
const GPS_WARN_M = 20;

type SheetName = "rig" | "lens" | null;

/**
 * The Shoot tab: live camera with the rig frame, one control row (Uploads · Seq · Light · Shutter ·
 * Fit · Human · Rig; a column in landscape), the lens strip, and HUD chips switched one by one in
 * Setup. A capture opens Tag (or queues directly); nothing is lost on the way: drafts and running
 * sequences are persisted, and a failed enqueue keeps the draft.
 */
export function Viewfinder({ active: tabActive }: { active: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  const app = useApp();
  const { settings, project, locations } = app;
  const [size, setSize] = useState<Box>({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };
  const window = size;
  const portrait = window.height >= window.width;
  const insets = useSafeAreaInsets();
  // App.tsx already pads by the cutout inset; top up to the 32 dp edge rule so the lens column never touches it.
  const lensPad = portrait ? 0 : Math.max(0, SIZE.edgePad - insets.left);
  const setSettings = app.setSettings;
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [locPerm, requestLocPerm] = Location.useForegroundPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const { active: rig } = useRigs();
  const [lensMm, setLensMm] = useState<number>(() => store.loadLensMm());
  const [sheet, setSheet] = useState<SheetName>(null);
  const [busy, setBusy] = useState(false);
  const sync = useSync();
  /** Capture or finished sequence waiting in Tag. */
  const [draft, setDraft] = useState<CaptureDraft | null>(() => restoreDraft(store.loadCaptureDraft()));
  /** Sequence mode: on while non-null; resumes after an app restart. */
  const [sequence, setSequence] = useState<CaptureDraft | null>(() => store.loadSequence());
  /** Mirrors `sequence` for code that runs across awaits (a capture can wait seconds for GPS). */
  const sequenceRef = useRef<CaptureDraft | null>(sequence);
  /** Flashlight; deliberately not remembered across launches. */
  const [torch, setTorch] = useState(false);

  const lensRange = lensRangeOf(rig);
  // Keep the lens inside the rig's range when the rig (or its range) changes.
  useEffect(() => { setLensMm((mm) => clampToRange(mm, lensRange)); }, [rig?.id, lensRange?.min, lensRange?.max]);
  useEffect(() => { store.saveLensMm(lensMm); }, [lensMm]);

  // Permissions and background sync on launch.
  useEffect(() => { if (camPerm && !camPerm.granted && camPerm.canAskAgain) void requestCamPerm(); }, [camPerm, requestCamPerm]);
  useEffect(() => { if (locPerm && !locPerm.granted && locPerm.canAskAgain) void requestLocPerm(); }, [locPerm, requestLocPerm]);
  const [authEmail, setAuthEmail] = useState<string | null>(() => signedInEmail());
  useEffect(() => {
    if (!isConfigured) return;
    const run = async () => {
      if (!isSignedIn()) return;
      await syncRigs(); // rigs live on the server; offline edits are pushed first
      await flush(); // also pulls the server's project and location lists
      app.setLocations(store.loadLocations());
    };
    void run();
    // Re-run after a sign-in so queued shots go out right away.
    return onAuthChange(() => { setAuthEmail(signedInEmail()); void run(); });
  }, []);

  // GPS: while the camera is on screen, watch so a capture has a warm fix. High precision watches at
  // the best accuracy every second, low precision at a battery-friendly accuracy every 5 s; off does
  // not start the location service at all (removing the watch stops it, no restart needed).
  const gpsMode = settings.gpsMode;
  const lastFix = useRef<Location.LocationObject | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  useEffect(() => {
    lastFix.current = null;
    setGpsAccuracy(null);
    if (!tabActive || !locPerm?.granted || gpsMode === "off") return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    // Android: ask once to turn on Google Location Accuracy (Wi-Fi/cell assisted), which fixes much faster and tighter.
    if (Platform.OS === "android") Location.enableNetworkProviderAsync().catch(() => {});
    const high = gpsMode === "high";
    Location.watchPositionAsync({ accuracy: high ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced, timeInterval: high ? 1000 : 5000, distanceInterval: 0 }, (pos) => {
      lastFix.current = pos;
      setGpsAccuracy(pos.coords.accuracy ?? null);
    }).then((x) => { if (cancelled) x.remove(); else sub = x; }).catch((e) => log("warn", "gps watch failed", e));
    return () => { cancelled = true; sub?.remove(); };
  }, [tabActive, locPerm?.granted, gpsMode]);

  // Toasts sit above the chrome block (portrait); in landscape the controls are a side column.
  useToastOffset(portrait ? CHROME_H : 0, tabActive);

  const area: Box = portrait
    ? { width: window.width, height: Math.max(0, window.height - CHROME_H) }
    : { width: Math.max(0, window.width - CONTROL_COL - LENS_COL - lensPad), height: window.height };
  const preview = useMemo(() => previewBox(area), [area.width, area.height]);
  const overlay = useMemo(() => (rig ? computeOverlay(settings, rig, lensMm, preview) : null), [settings, rig, lensMm, preview]);

  /**
   * The position for a capture, or null (GPS off, or no fix at all; the photo is kept without one).
   * In a running sequence every photo after the first takes the first one's position, so frames
   * never wait on GPS. Low precision takes what the phone has right now; high may wait up to 8 s.
   */
  async function getPosition(): Promise<Fix | null> {
    const seqFirst = sequenceRef.current?.photos[0]?.meta;
    if (seqFirst && seqFirst.lat !== null && seqFirst.lon !== null) {
      return { lat: seqFirst.lat, lon: seqFirst.lon, accuracy: seqFirst.gps_accuracy_m, altitude: null, heading: null, at: Date.now(), reused: true };
    }
    if (gpsMode === "off") return null;
    if (!locPerm?.granted) {
      const r = await requestLocPerm();
      if (!r.granted) return null;
    }
    const watched = lastFix.current;
    // Low precision (and a sequence whose first photo had no fix): never wait.
    if (gpsMode === "low" || seqFirst) return toFix(watched ?? (await Location.getLastKnownPositionAsync({ maxAge: LOW_MAX_AGE_MS }).catch(() => null)));
    if (watched && Date.now() - watched.timestamp < FIX_MAX_AGE_MS) return toFix(watched);
    const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    const timeout = new Promise<null>((res) => setTimeout(() => res(null), 8000));
    const pos = await Promise.race([fresh.catch(() => null), timeout]);
    return toFix(pos ?? lastFix.current ?? (await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 }).catch(() => null)));
  }

  async function capture() {
    if (!camera.current || !cameraReady || busy || !rig || !overlay || !project) return;
    setBusy(true);
    const seqAtStart = sequenceRef.current?.shotId ?? null;
    try {
      const [pos, pic] = await Promise.all([
        getPosition(),
        camera.current.takePictureAsync({ quality: 0.7, exif: true, skipProcessing: false }),
      ]);
      // Never lose a capture for want of a fix: it is kept without a position (set one later by hand).
      if (!pos && gpsMode !== "off") { log("warn", "capture without GPS fix", { mode: gpsMode }); toast("No GPS fix · saved without position", "neutral"); }
      const landscapePic = pic.width >= pic.height;
      const rendered = await ImageManipulator.manipulate(pic.uri)
        .resize(landscapePic ? { width: Math.min(MAX_UPLOAD_EDGE, pic.width) } : { height: Math.min(MAX_UPLOAD_EDGE, pic.height) })
        .renderAsync();
      const small = await rendered.saveAsync({ compress: 0.72, format: SaveFormat.JPEG });
      try { new File(pic.uri).delete(); } catch { /* full-size camera temp file */ }

      const exif = (pic.exif ?? {}) as Record<string, unknown>;
      const frame = { width: round4(overlay.fractions.width), height: round4(overlay.fractions.height) };
      const meta: PhotoMetadata = {
        id: Crypto.randomUUID(),
        ordinal: 0,
        timestamp: new Date().toISOString(),
        lat: pos?.lat ?? null,
        lon: pos?.lon ?? null,
        gps_accuracy_m: pos?.accuracy ?? null,
        lens_mm: lensMm,
        preset_id: rig.synced ? rig.id : null,
        width: small.width,
        height: small.height,
        framing: {
          preset_name: rig.name,
          camera_id: rig.cameraId,
          format_id: rig.formatId,
          sensor_width_mm: rig.sensorWidthMm,
          sensor_height_mm: rig.sensorHeightMm,
          speedbooster_factor: rig.speedboosterFactor,
          lens_mm: lensMm,
          rig_orientation: settings.rigOrientation,
          effective_focal_mm: round(overlay.framing.effectiveFocalLengthMm),
          full_frame_equivalent_mm: round(overlay.framing.fullFrameEquivalentMm),
          hfov_deg: round(overlay.framing.fov.horizontal),
          vfov_deg: round(overlay.framing.fov.vertical),
          // Rig frame relative to the uploaded photo, centred. Lets the dashboard re-apply the mask.
          frame: { width_fraction: frame.width, height_fraction: frame.height },
          // Phone view the photo was taken with, so other rigs/lenses can be simulated on it later.
          phone_equivalent_focal_mm: settings.phoneEquivalentFocalMm,
        },
        device: {
          phone_model: PHONE.model,
          exif_focal_length: exif.FocalLength ?? null,
          exif_focal_length_35mm: exif.FocalLengthIn35mmFilm ?? null,
          exif_model: exif.Model ?? null,
          gps_mode: gpsMode,
          gps_altitude_m: pos?.altitude ?? null,
          gps_heading_deg: pos?.heading ?? null,
          gps_fix_age_ms: pos ? Date.now() - pos.at : null,
          // Taken over from the sequence's first photo.
          gps_from_first_photo: pos?.reused ?? false,
        },
      };
      log("info", "capture", { lens: lensMm, rig: rig.name, gps_accuracy_m: meta.gps_accuracy_m, sequence: !!seqAtStart, direct: settings.directUpload });
      // Rig unknown to the server: try once more now so the reference can be set on the row later.
      if (!rig.synced) void saveRig(rig, true);
      const photo: DraftPhoto = { uri: small.uri, meta, frame };
      // Joins the sequence only if the one that was on when the shutter fired is still on.
      const seq = sequenceRef.current;
      if (seqAtStart && seq && seq.shotId === seqAtStart) {
        const next = addToSequence(seq, photo);
        sequenceRef.current = next;
        setSequence(next);
      } else {
        const single: CaptureDraft = { shotId: Crypto.randomUUID(), photos: [keepPhoto(photo)] };
        if (settings.directUpload) finishDraft(single);
        else openDraft(single); // nothing is queued until the user taps Upload
      }
    } catch (err) {
      log("error", "capture failed", err);
      void notice("Capture failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Show a draft in Tag; it is stored so it reopens after an app restart. */
  function openDraft(d: CaptureDraft) {
    store.saveCaptureDraft(d);
    setDraft(d);
  }

  /** Direct upload: queue without tags; if that fails the draft opens in Tag instead of being lost. */
  function finishDraft(d: CaptureDraft) {
    store.saveCaptureDraft(d);
    if (queueDraft(d, EMPTY_TAGS, null)) { store.saveCaptureDraft(null); toast("Queued untagged · tag it later in History", "neutral"); }
    else setDraft(d);
  }

  /** Queue a capture or sequence as one shot of the active project; the upload runs in the background. */
  function queueDraft(d: CaptureDraft, tags: ShotTags, newLocation: LocationEntry | null, newSpot: SpotEntry | null = null): boolean {
    if (!project) return false;
    if (newLocation) { const next = [...locations, newLocation]; app.setLocations(next); store.saveLocations(next); }
    if (newSpot) { const next = [...app.spots, newSpot]; app.setSpots(next); store.saveSpots(next); }
    const metadata: ShotMetadata = { id: d.shotId, project_id: project.id, ...tags, photos: d.photos.map((p) => p.meta) };
    try {
      enqueue(metadata, Object.fromEntries(d.photos.map((p) => [p.meta.id, p.uri])));
    } catch (err) {
      log("error", "enqueue failed", err);
      void notice("Could not save the shot", `${err instanceof Error ? err.message : String(err)}. The photos are kept; try Upload again.`);
      return false; // keep the draft so nothing is lost
    }
    deleteDraftFiles(d); // the queue has its own copies now
    void flush().then(() => { app.setLocations(store.loadLocations()); app.setSpots(store.loadSpots()); });
    return true;
  }

  function uploadDraft(tags: ShotTags, newLocation: LocationEntry | null, newSpot: SpotEntry | null) {
    if (!draft) return;
    if (queueDraft(draft, tags, newLocation, newSpot)) {
      store.saveCaptureDraft(null);
      setDraft(null);
      toast(`Queued · ${tags.name ?? (draft.photos.length > 1 ? `sequence of ${draft.photos.length}` : "untitled shot")}`);
    }
  }

  function discardDraft() {
    if (draft) { deleteDraftFiles(draft); log("info", "draft discarded", { shot: draft.shotId, photos: draft.photos.length }); }
    store.saveCaptureDraft(null);
    setDraft(null);
  }

  function toggleSequence() {
    const d = sequenceRef.current;
    if (!d) {
      const started = startSequence();
      sequenceRef.current = started;
      setSequence(started);
      toast("Sequence on: every photo joins one shot", "neutral");
      return;
    }
    sequenceRef.current = null;
    setSequence(null);
    log("info", "sequence end", { shot: d.shotId, photos: d.photos.length });
    if (d.photos.length === 0) { store.saveSequence(null); toast("Sequence off", "neutral"); return; }
    // Store the finished sequence as the draft before forgetting it as the running sequence.
    store.saveCaptureDraft(d);
    store.saveSequence(null);
    if (settings.directUpload) finishDraft(d);
    else setDraft(d);
  }

  /** Cycle: off -> 35 -> 43 -> 50 -> off. Toggle: off <-> the chosen value (Setup). */
  function pressHuman() {
    setSettings((x) => {
      if (x.humanViewButton === "toggle") return { ...x, humanViewEnabled: !x.humanViewEnabled };
      if (!x.humanViewEnabled) return { ...x, humanViewEnabled: true, humanViewFocalMm: HUMAN_STEPS[0] };
      const i = HUMAN_STEPS.indexOf(x.humanViewFocalMm);
      if (i < 0 || i === HUMAN_STEPS.length - 1) return { ...x, humanViewEnabled: false };
      return { ...x, humanViewFocalMm: HUMAN_STEPS[i + 1] };
    });
  }

  const countAt = useCallback((id: string) => app.countAt(id), [app.countAt]);

  if (!camPerm) return <View style={s.root} onLayout={onLayout} />;
  if (!camPerm.granted) {
    return (
      <View style={[s.root, s.center, { backgroundColor: c.bg }]}>
        <Empty icon="camera-off" title="Camera access needed" body="Fielder uses the camera as a viewfinder for your rig's frame.">
          <Button label="Grant camera access" icon="camera-iris" onPress={() => void requestCamPerm()} />
        </Empty>
      </View>
    );
  }

  const shutterOff = busy || !rig || !cameraReady || !project;
  const chips = settings.hudChips;
  // Off is a choice, not a warning; low precision only warns when there is no fix at all.
  const gpsPoor = gpsMode !== "off" && (gpsAccuracy == null || (gpsMode === "high" && gpsAccuracy > GPS_WARN_M));
  const gpsText = gpsMode === "off" ? "GPS off" : `${gpsMode === "low" ? "GPS low" : "GPS"} ${gpsAccuracy == null ? "· no fix yet" : `±${Math.round(gpsAccuracy)} m`}`;
  const n = sync.state === "stuck" ? sync.stuck : sync.pending;

  // Keyed by state: Android does not redraw a dashed border back to solid, nor re-round a view whose
  // background goes from transparent to a colour, so each state mounts fresh (else a square disc at start).
  const shutterKey = busy ? "busy" : shutterOff ? "off" : sequence ? "seq" : "on";
  const shutter = (
    <Pressable key={shutterKey} onPress={capture} disabled={shutterOff} accessibilityRole="button" accessibilityLabel={sequence ? `Capture into sequence, ${sequence.photos.length} so far` : "Capture"}
      style={[s.shutter, sequence && s.shutterSeq, shutterOff && !busy && s.shutterOff]}>
      {({ pressed }) => busy
        ? <ActivityIndicator color={c.chromeText} size="large" />
        : <View style={[s.disc, pressed && s.discPressed, sequence && { backgroundColor: FIXED.record }, shutterOff && { backgroundColor: "transparent" }]}>
            {sequence ? <Text style={s.discText}>{sequence.photos.length}</Text> : shutterOff ? <Icon name="close" size={28} color={c.textDisabled} /> : null}
          </View>}
    </Pressable>
  );
  const cell = (key: string, node: ReactNode) => <View key={key} style={s.cell}>{node}</View>;
  // Portrait, left → right. Landscape reads top → bottom as portrait right → left (phone turned counter-clockwise).
  const controls = [
    cell("uploads", <Control icon="cloud-upload-outline" label={n ? `Uploads, ${n} ${sync.state === "stuck" ? "stuck" : "waiting"}. Tap to retry, hold for the list` : "Uploads. Hold for the list"} vertical={!portrait}
      onPress={() => void retryAll()} onLongPress={() => app.push({ name: "uploads" })} badge={n > 0 && sync.state !== "ok" ? <Badge n={n} stuck={sync.state === "stuck"} /> : null} />),
    cell("seq", <Control icon="layers-triple-outline" label={sequence ? "End sequence" : "Start sequence"} on={!!sequence} disabled={busy} vertical={!portrait} onPress={toggleSequence} />),
    cell("light", <Control icon={torch ? "flashlight" : "flashlight-off"} label="Light" on={torch} vertical={!portrait} onPress={() => setTorch((t) => !t)} />),
    <View key="shutter" style={s.shutterCell}>{shutter}</View>,
    cell("fit", <Control icon="fit-to-screen-outline" label="Fit to frame" on={settings.fitToFrame} vertical={!portrait} onPress={() => setSettings((x) => ({ ...x, fitToFrame: !x.fitToFrame }))} />),
    cell("human", <Control icon="human-male" label={settings.humanViewEnabled ? `Human view ${settings.humanViewFocalMm} mm` : "Human view"} on={settings.humanViewEnabled} vertical={!portrait} onPress={pressHuman} />),
    cell("rig", <Control icon="camera-control" label={rig ? `Rig ${rig.name}` : "Rig, none yet"} warn={!rig} vertical={!portrait} onPress={() => setSheet("rig")} />),
  ];
  const lensStrip = <LensStrip lensMm={lensMm} onChange={setLensMm} vertical={!portrait} range={lensRange} onPressValue={() => setSheet("lens")} />;

  const hud = (
    <View style={[s.hud, !portrait && { justifyContent: "center" }]} pointerEvents="box-none">
      {project && chips.project && <HudChip icon="folder-outline" onPress={app.openProjectSheet} label={`Project ${project.name}, tap to switch`}>{project.name}</HudChip>}
      {!project && chips.warnings && <HudChip icon="folder-alert-outline" kind="danger" onPress={app.openProjectSheet} label="No project, tap to pick">No project</HudChip>}
      {rig && chips.rig && <HudChip icon="camera-outline">{rig.name} · {lensMm} mm{rig.speedboosterFactor !== 1 ? ` ×${rig.speedboosterFactor}` : ""}</HudChip>}
      {overlay && chips.fov && (
        <HudChip icon="angle-acute">{round(overlay.framing.fullFrameEquivalentMm)} mm FF · {formatDeg(overlay.framing.fov.horizontal)} × {formatDeg(overlay.framing.fov.vertical)}{settings.fitToFrame && !overlay.exceedsPreview ? ` · fit ×${(overlay.camera.width / preview.width).toFixed(2)}` : ""}</HudChip>
      )}
      {overlay?.human && chips.fov && (
        <HudChip icon="human-male" iconColor={HUMAN_COLOR}>{overlay.human.relation === "equal" ? "Matches the human view" : overlay.human.relation === "wider" ? "Wider than the human view" : overlay.human.fits ? "Narrower than the human view" : "Narrower; human frame off screen"}</HudChip>
      )}
      {chips.gps ? <HudChip icon={gpsMode === "off" ? "crosshairs-off" : gpsPoor ? "crosshairs-question" : "crosshairs-gps"} kind={gpsPoor && chips.warnings ? "warn" : undefined}>{gpsText}</HudChip>
        : chips.warnings && gpsPoor && <HudChip icon="crosshairs-question" kind="warn">{gpsAccuracy == null ? "No GPS" : gpsText}</HudChip>}
      {chips.warnings && overlay?.exceedsPreview && <HudChip icon="arrow-expand-all" kind="warn">Rig sees more than the phone: black = outside its view</HudChip>}
      {chips.warnings && !isConfigured && <HudChip icon="cloud-off-outline" kind="warn">No server in this build; shots stay on the phone</HudChip>}
      {chips.warnings && isConfigured && !authEmail && <HudChip icon="account-alert-outline" kind="warn" onPress={app.signIn} label="Not signed in, tap to sign in">Not signed in · shots stay on the phone</HudChip>}
    </View>
  );
  // Blocking states get an opaque card with the one action that fixes them.
  const card = !rig
    ? <NoticeCard icon="camera-control" title="Set up a rig" body="The frame needs a camera body and format." action="New rig" onPress={() => app.push({ name: "rigEditor", rigId: null })} />
    : !project
      ? <NoticeCard icon="folder-alert-outline" title="No project" body="Every shot goes into a project. Pick one to shoot." action="Pick" onPress={app.openProjectSheet} />
      : null;

  return (
    <View style={[s.root, { flexDirection: portrait ? "column" : "row" }]} onLayout={onLayout}>
      <StatusBar hidden={tabActive} />
      {!portrait && <View style={[s.lensCol, { width: LENS_COL + lensPad, paddingLeft: lensPad }]}>{lensStrip}</View>}
      <View style={[s.previewArea, { width: area.width, height: area.height }]}>
        <View style={{ width: preview.width, height: preview.height, backgroundColor: FIXED.photoBg, overflow: "hidden" }}>
          {window.width > 0 && (
            <CameraView
              ref={camera}
              active={tabActive}
              style={overlay ? { position: "absolute", ...overlay.camera } : StyleSheet.absoluteFill}
              facing="back"
              ratio="4:3"
              enableTorch={torch && tabActive}
              animateShutter={false}
              onCameraReady={() => setCameraReady(true)}
            />
          )}
          {overlay && <Overlay preview={preview} rect={overlay.rect} settings={settings} exceedsPreview={overlay.exceedsPreview} human={overlay.human} />}
          {sequence && <View style={s.seqBadge} pointerEvents="none"><SeqBadge count={sequence.photos.length} recording /></View>}
          {card && <View style={s.cardWrap} pointerEvents="box-none">{card}</View>}
        </View>
        {hud}
      </View>
      {portrait ? (
        <View style={s.chrome}>
          {lensStrip}
          <View style={s.row}>{controls}</View>
        </View>
      ) : (
        <View style={[s.chrome, s.column]}>{[...controls].reverse()}</View>
      )}

      {/* Only on Shoot: a draft restored at launch waits until the gates are through. */}
      {draft && tabActive && (
        <Tag draft={draft} settings={settings} project={project} locations={locations} spots={app.spots} countAt={countAt}
          fields={store.fieldsForProject(project?.id)} onUpload={uploadDraft} onDiscard={discardDraft} />
      )}
      <RigSheet visible={sheet === "rig"} onClose={() => setSheet(null)} onEdit={(id) => app.push({ name: "rigEditor", rigId: id })} />
      <LensSheet visible={sheet === "lens"} onClose={() => setSheet(null)} lensMm={lensMm} onChange={setLensMm} range={lensRange} />
    </View>
  );
}

/** An icon-only viewfinder control: the whole cell is the target, the visual is 46 × 56 (56 × 46 in landscape). On = accent fill. */
function Control({ icon, label, onPress, onLongPress, on, disabled, warn, badge, vertical }: { icon: string; label: string; onPress: () => void; onLongPress?: () => void; on?: boolean; disabled?: boolean; warn?: boolean; badge?: ReactNode; vertical: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  const fg = disabled ? c.textDisabled : on ? c.onAccent : c.chromeText;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={500} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on, disabled }}
      style={s.hit}>
      {({ pressed }) => (
        <View style={[s.ctl, vertical ? { width: 56, height: 46 } : { width: 46, height: 56 }, on && { backgroundColor: c.accent, borderColor: c.accent }, warn && { borderColor: c.warn }, pressed && s.ctlPressed, disabled && s.ctlOff]}>
          <Icon name={icon} size={26} color={fg} />
          {badge}
        </View>
      )}
    </Pressable>
  );
}

function NoticeCard({ icon, title, body, action, onPress }: { icon: string; title: string; body: string; action: string; onPress: () => void }) {
  const s = useStyles();
  return (
    <View style={s.card}>
      <Icon name={icon} size={28} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.cardTitle}>{title}</Text>
        <Text style={s.cardBody}>{body}</Text>
      </View>
      <Button label={action} onPress={onPress} />
    </View>
  );
}

const round = (x: number) => Math.round(x * 10) / 10;
const round4 = (x: number) => Math.round(x * 10000) / 10000;

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: FIXED.photoBg },
  center: { alignItems: "center", justifyContent: "center", padding: 24 },
  previewArea: { alignItems: "center", justifyContent: "center" },
  hud: { position: "absolute", top: 8, left: 8, right: 8, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  seqBadge: { position: "absolute", bottom: 12, left: 12 },
  cardWrap: { position: "absolute", left: 12, right: 12, top: 0, bottom: 0, justifyContent: "center" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: RADIUS.md, backgroundColor: c.surfaceRaised, borderWidth: BORDER.control, borderColor: c.borderStrong },
  cardTitle: { ...type("body", "bold"), color: c.text },
  cardBody: { ...type("small"), color: c.textDim },
  chrome: { backgroundColor: c.chromeBg, borderColor: c.chromeBorder, borderTopWidth: BORDER.control, paddingTop: 10, paddingHorizontal: 8, paddingBottom: 12, gap: 10 },
  column: { width: CONTROL_COL, borderTopWidth: 0, borderLeftWidth: BORDER.control, paddingHorizontal: 0, paddingVertical: 8, gap: 0 },
  lensCol: { backgroundColor: c.chromeBg, borderRightWidth: BORDER.control, borderRightColor: c.chromeBorder },
  row: { flexDirection: "row", alignItems: "center", height: SIZE.shutter },
  cell: { flex: 1, alignSelf: "stretch" },
  hit: { flex: 1, alignItems: "center", justifyContent: "center" },
  shutterCell: { padding: 4, alignItems: "center", justifyContent: "center" },
  ctl: { alignItems: "center", justifyContent: "center", borderRadius: 10, borderWidth: BORDER.control, borderColor: c.chromeBorder, backgroundColor: c.chromeBg },
  ctlPressed: { transform: [{ translateY: 1 }], borderColor: c.chromeText },
  ctlOff: { borderStyle: "dashed", borderColor: c.textDisabled },
  shutter: { width: SIZE.shutter, height: SIZE.shutter, borderRadius: SIZE.shutter / 2, borderWidth: 4, borderColor: c.chromeText, backgroundColor: c.chromeBg, alignItems: "center", justifyContent: "center" },
  shutterSeq: { borderColor: FIXED.record, borderWidth: 5 },
  shutterOff: { borderStyle: "dashed", borderColor: c.textDisabled, borderWidth: 3 },
  disc: { width: 58, height: 58, borderRadius: 29, backgroundColor: c.chromeText, alignItems: "center", justifyContent: "center" },
  discPressed: { width: 52, height: 52, borderRadius: 26 },
  discText: { ...type("title", "heavy"), color: FIXED.white, ...num },
}));
