import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { Camera, CommonResolutions, useCameraDevice, useCameraPermission, usePhotoOutput, type CameraRef } from "react-native-vision-camera";
import * as Location from "expo-location";
import * as Crypto from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File, Paths } from "expo-file-system";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HUMAN_STEPS } from "../defaults";
import { api } from "../api";
import { useApp } from "../appState";
import { isSignedIn, onAuthChange, signedInEmail } from "../auth";
import { isConfigured } from "../config";
import { VF_SHORT_LABELS, type VfBar, type VfControl, type VfItem } from "@fielder/vocab";
import { calibrationFromExif } from "../calibration";
import { readExif, uprightSize } from "../exif";
import { effectiveZoom, offeredZooms, zoomStops, type ZoomRange } from "../zoom";
import { edgeExtent, resolveLayout, rowHeight, VF_SIZES } from "../vfLayout";
import { computeOverlay, formatDeg, previewBox, type Box } from "../framing";
import { clampToRange } from "../lens";
import { log } from "../log";
import { saveRig, syncRigs, useRigs } from "../rigs";
import { addToSequence, deleteDraftFiles, keepPhoto, restoreDraft, startSequence } from "../sequence";
import { store } from "../storage";
import { useSync } from "../sync";
import { lensRangeOf, type CaptureDraft, type DraftPhoto, type LocationEntry, type PhotoMetadata, type SpotEntry, type ShotMetadata, type ShotTags } from "../types";
import { enqueue, flush } from "../uploads";
import { Badge, BORDER, Button, Empty, FIXED, Icon, makeStyles, notice, num, RADIUS, SeqBadge, SIZE, toast, type, useTheme, useToastOffset } from "../ui";
import { HudChip } from "../components/Hud";
import { LensSheet } from "../components/LensSheet";
import { LensCarousel, LensStrip, ZoomStrip } from "../components/LensStrip";
import { HUMAN_COLOR, Overlay } from "../components/Overlay";
import { RigSheet } from "../components/RigSheet";
import { EMPTY_TAGS } from "../components/TagEditor";
import { retryAll } from "./Uploads";
import { Tag } from "./Tag";

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
  const camPerm = useCameraPermission();
  const [locPerm, requestLocPerm] = Location.useForegroundPermissions();
  // vision-camera (issue #26): the back camera as Android's logical camera, so the zoom reaches every lens.
  const device = useCameraDevice("back");
  const photoOutput = usePhotoOutput({ targetResolution: CommonResolutions.UHD_4_3, quality: 0.9, qualityPrioritization: "balanced" });
  const camera = useRef<CameraRef>(null);
  const [cameraReady, setCameraReady] = useState(false);
  /** The camera's zoom range as reported once it runs (remembered for Setup); null before. */
  const [zoomRange, setZoomRange] = useState<ZoomRange | null>(() => store.loadZoomRange());
  const [chosenZoom, setChosenZoom] = useState<number>(() => store.loadZoom());

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
  const zooms = offeredZooms(zoomStops(zoomRange), settings.phoneLenses);
  const zoom = effectiveZoom(chosenZoom, zooms);
  const pickZoom = (z: number) => { setChosenZoom(z); store.saveZoom(z); log("info", "phone lens", { zoom: z }); };
  useEffect(() => {
    if (!device) return;
    log("info", "camera device", {
      id: device.id, type: device.type, name: device.localizedName, virtual: device.isVirtualDevice, focal_mm: device.focalLength ?? null,
      min_zoom: device.minZoom, max_zoom: device.maxZoom, switch: device.zoomLensSwitchFactors, torch: device.hasTorch,
      physical: device.physicalDevices.map((p) => ({ id: p.id, type: p.type, focal_mm: p.focalLength ?? null })),
    });
  }, [device?.id]);
  /** Called when the session runs: the controller knows the real zoom range (the device may report 0 before). */
  const onCameraStarted = () => {
    setCameraReady(true);
    const ctl = camera.current?.controller;
    if (ctl && ctl.maxZoom >= 1) {
      const r = { min: ctl.minZoom, max: ctl.maxZoom };
      log("info", "camera started", { min_zoom: r.min, max_zoom: r.max, zoom: ctl.zoom, display_zoom: ctl.displayableZoomFactor, stops: zoomStops(r) });
      if (r.min !== zoomRange?.min || r.max !== zoomRange?.max) { setZoomRange(r); store.saveZoomRange(r); }
    } else log("warn", "camera started without a controller", {});
  };

  // Permissions and background sync on launch.
  useEffect(() => { if (!camPerm.hasPermission && camPerm.canRequestPermission) void camPerm.requestPermission(); }, [camPerm.hasPermission, camPerm.canRequestPermission]);
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

  // The bars come from the chosen viewfinder layout (issue #49), or from the dashboard while it previews one (#50).
  const vfLayout = app.preview?.layout ?? resolveLayout(settings.viewfinderLayoutId, app.layouts);
  const inert = !!app.preview;
  const bars = portrait ? vfLayout.portrait : vfLayout.landscape;
  const startBars = bars.bars.filter((b) => b.edge === "start");
  const endBars = bars.bars.filter((b) => b.edge === "end");
  const startExtent = edgeExtent(bars, "start", portrait, lensPad);
  const endExtent = edgeExtent(bars, "end", portrait);
  // Toasts sit above the bottom bars (portrait); in landscape the bars are side columns.
  useToastOffset(portrait ? endExtent : 0, tabActive);

  const area: Box = portrait
    ? { width: window.width, height: Math.max(0, window.height - startExtent - endExtent) }
    : { width: Math.max(0, window.width - startExtent - endExtent), height: window.height };
  const preview = useMemo(() => previewBox(area), [area.width, area.height]);
  // The phone sees narrower or wider by the zoom: its 35 mm equivalent is the main lens's times the zoom.
  const phoneMm = settings.phoneEquivalentFocalMm * zoom;
  const overlay = useMemo(() => (rig ? computeOverlay({ ...settings, phoneEquivalentFocalMm: phoneMm }, rig, lensMm, preview) : null), [settings, phoneMm, rig, lensMm, preview]);

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

  /**
   * One photo through vision-camera: the encoded JPEG (its EXIF read here, since vision-camera does not
   * expose it) written to a temp file for the manipulator. Each step is logged for the debug log.
   */
  async function takePhoto(): Promise<{ uri: string; width: number; height: number; exif: ReturnType<typeof readExif> }> {
    const t0 = Date.now();
    const photo = await photoOutput.capturePhoto({ flashMode: "off", enableShutterSound: false }, {});
    try {
      const bytes = new Uint8Array(await photo.getFileDataAsync());
      const exif = readExif(bytes);
      const file = new File(Paths.cache, `capture-${Crypto.randomUUID()}.jpg`);
      file.write(bytes);
      log("info", "photo taken", { ms: Date.now() - t0, size: [photo.width, photo.height], orientation: photo.orientation, bytes: bytes.length, exif });
      return { uri: file.uri, width: photo.width, height: photo.height, exif };
    } finally {
      photo.dispose();
    }
  }

  async function capture() {
    if (!cameraReady || busy || !rig || !overlay || !project) return;
    setBusy(true);
    const seqAtStart = sequenceRef.current?.shotId ?? null;
    try {
      const shot = takePhoto();
      const [pos, pic] = await Promise.all([getPosition(), shot]);
      // Never lose a capture for want of a fix: it is kept without a position (set one later by hand).
      if (!pos && gpsMode !== "off") { log("warn", "capture without GPS fix", { mode: gpsMode }); toast("No GPS fix · saved without position", "neutral"); }
      // Glide (behind the manipulator) applies the EXIF rotation, so the size to aim for is the upright one.
      const upright = uprightSize(pic.width, pic.height, pic.exif.Orientation);
      const rendered = await ImageManipulator.manipulate(pic.uri)
        .resize(upright.width >= upright.height ? { width: Math.min(MAX_UPLOAD_EDGE, upright.width) } : { height: Math.min(MAX_UPLOAD_EDGE, upright.height) })
        .renderAsync();
      const small = await rendered.saveAsync({ compress: 0.72, format: SaveFormat.JPEG });
      log("info", "capture resized", { raw: [pic.width, pic.height], orientation: pic.exif.Orientation ?? null, upright: [upright.width, upright.height], small: [small.width, small.height] });
      try { new File(pic.uri).delete(); } catch { /* full-size camera temp file */ }

      const exif = pic.exif as Record<string, unknown>;
      // Auto calibration (issue #26): the photo's own EXIF says how wide the main lens saw. Only at 1×:
      // other zooms are other lenses (or a crop). A changed value frames this capture and the next ones.
      const calib = settings.phoneCalibration === "auto" && zoom === 1 ? calibrationFromExif(exif) : null;
      const mainMm = calib?.mm ?? settings.phoneEquivalentFocalMm;
      const usedPhoneMm = mainMm * zoom;
      if (zoom !== 1) log("info", "capture at zoom", { zoom, phone_mm: usedPhoneMm, exif_35mm: exif.FocalLengthIn35mmFilm ?? null, exif_mm: exif.FocalLength ?? null });
      const used = usedPhoneMm !== phoneMm ? computeOverlay({ ...settings, phoneEquivalentFocalMm: usedPhoneMm }, rig, lensMm, preview) : overlay;
      if (calib && (calib.mm !== settings.phoneEquivalentFocalMm || calib.model !== settings.phoneModel)) {
        log("info", "phone calibrated from EXIF", { mm: calib.mm, model: calib.model, was: settings.phoneEquivalentFocalMm });
        setSettings((x) => ({ ...x, phoneEquivalentFocalMm: calib.mm, phoneModel: calib.model }));
      }
      const frame = { width: round4(used.fractions.width), height: round4(used.fractions.height) };
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
          effective_focal_mm: round(used.framing.effectiveFocalLengthMm),
          full_frame_equivalent_mm: round(used.framing.fullFrameEquivalentMm),
          hfov_deg: round(used.framing.fov.horizontal),
          vfov_deg: round(used.framing.fov.vertical),
          // Rig frame relative to the uploaded photo, centred. Lets the dashboard re-apply the mask.
          frame: { width_fraction: frame.width, height_fraction: frame.height },
          // Phone view the photo was taken with, so other rigs/lenses can be simulated on it later.
          phone_equivalent_focal_mm: round(usedPhoneMm),
        },
        device: {
          phone_model: calib?.model ?? settings.phoneModel,
          exif_focal_length: exif.FocalLength ?? null,
          exif_focal_length_35mm: exif.FocalLengthIn35mmFilm ?? null,
          exif_model: exif.Model ?? null,
          // Issue #26: the phone lens (zoom on the logical back camera) and the main lens's equivalent.
          zoom,
          phone_main_equivalent_mm: mainMm,
          camera_id: device?.id ?? null,
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

  if (!camPerm.hasPermission) {
    return (
      <View style={[s.root, s.center, { backgroundColor: c.bg }]}>
        <Empty icon="camera-off" title="Camera access needed" body="Fielder uses the camera as a viewfinder for your rig's frame.">
          <Button label="Grant camera access" icon="camera-iris" onPress={() => { if (camPerm.canRequestPermission) void camPerm.requestPermission(); else void Linking.openSettings(); }} />
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
  // One builder per button; the layout decides which appear, where, and with a text label or not.
  const vertical = !portrait;
  const buttons: Record<Exclude<VfControl, "shutter" | "lens" | "zoom">, (text?: string) => ReactNode> = {
    uploads: (text) => <Control icon="cloud-upload-outline" text={text} label={n ? `Uploads, ${n} ${sync.state === "stuck" ? "stuck" : "waiting"}. Tap to retry, hold for the list` : "Uploads. Hold for the list"} vertical={vertical}
      onPress={() => void retryAll()} onLongPress={() => app.push({ name: "uploads" })} badge={n > 0 && sync.state !== "ok" ? <Badge n={n} stuck={sync.state === "stuck"} /> : null} />,
    seq: (text) => <Control icon="layers-triple-outline" text={text} label={sequence ? "End sequence" : "Start sequence"} on={!!sequence} disabled={busy} vertical={vertical} onPress={toggleSequence} />,
    light: (text) => <Control icon={torch ? "flashlight" : "flashlight-off"} text={text} label="Light" on={torch} vertical={vertical} onPress={() => setTorch((t) => !t)} />,
    fit: (text) => <Control icon="fit-to-screen-outline" text={text} label="Fit to frame" on={settings.fitToFrame} vertical={vertical} onPress={() => setSettings((x) => ({ ...x, fitToFrame: !x.fitToFrame }))} />,
    human: (text) => <Control icon="human-male" text={text} label={settings.humanViewEnabled ? `Human view ${settings.humanViewFocalMm} mm` : "Human view"} on={settings.humanViewEnabled} vertical={vertical} onPress={pressHuman} />,
    rig: (text) => <Control icon="camera-control" text={text} label={rig ? `Rig ${rig.name}` : "Rig, none yet"} warn={!rig} vertical={vertical} onPress={() => setSheet("rig")} />,
  };
  const barItem = (it: VfItem, fixed: boolean) => {
    if (it.control === "shutter") return <View key="shutter" style={s.shutterCell}>{shutter}</View>;
    if (it.control === "zoom") return <ZoomStrip key="zoom" zoom={zoom} zooms={zooms} onChange={pickZoom} vertical={vertical} />;
    if (it.control === "lens") {
      const Strip = it.display === "carousel" ? LensCarousel : LensStrip;
      return <View key="lens" style={it.size === "fit" ? s.lensFit : s.lensFill}><Strip lensMm={lensMm} onChange={setLensMm} vertical={vertical} range={lensRange} onPressValue={() => setSheet("lens")} /></View>;
    }
    // Next to a lens strip that fills the bar, buttons keep their own size; otherwise they share the bar.
    return <View key={it.control} style={fixed ? (vertical ? s.cellV : s.cellH) : s.cell}>{buttons[it.control](it.label ? VF_SHORT_LABELS[it.control] : undefined)}</View>;
  };
  const bar = (b: VfBar) => {
    const fixed = b.items.some((i) => i.control === "lens" && i.size !== "fit");
    // In a dashboard preview the buttons only show where they would be: no capture, no toggles.
    return <View key={b.id} pointerEvents={inert ? "none" : "auto"} style={[vertical ? s.barV : [s.row, { height: rowHeight(b) }], inert && s.inert]}>{b.items.map((i) => barItem(i, fixed))}</View>;
  };
  const sideBar = (b: VfBar, start: boolean, first: boolean) => {
    const pad = start && first ? lensPad : 0;
    const lensOnly = b.items.length === 1 && b.items[0].control === "lens";
    return <View key={b.id} style={[s.side, start ? s.sideStart : s.sideEnd, { width: VF_SIZES.column + pad, paddingLeft: pad }, !lensOnly && { paddingVertical: 8 }]}>{bar(b)}</View>;
  };

  const hud = (
    <View style={[s.hud, !portrait && { justifyContent: "center" }]} pointerEvents="box-none">
      {inert && <HudChip icon="cellphone-play" kind="warn" onPress={app.exitPreview} label="Layout preview from the dashboard, buttons off. Tap to leave">Dashboard preview · buttons off · tap to leave</HudChip>}
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
      {portrait ? startBars.length > 0 && <View style={[s.chrome, s.chromeTop]}>{startBars.map(bar)}</View> : startBars.map((b, i) => sideBar(b, true, i === 0))}
      <View style={[s.previewArea, { width: area.width, height: area.height }]}>
        <View style={{ width: preview.width, height: preview.height, backgroundColor: FIXED.photoBg, overflow: "hidden" }}>
          {window.width > 0 && device && (
            // contain: the 4:3 stream fills the 4:3 box exactly; if a phone ever streamed another ratio,
            // bars would show it instead of a silent crop that would make the frame lie.
            <Camera
              ref={camera}
              device={device}
              isActive={tabActive}
              outputs={[photoOutput]}
              zoom={zoomRange ? Math.min(zoomRange.max, Math.max(zoomRange.min, zoom)) : 1}
              torchMode={torch && tabActive && device.hasTorch ? "on" : "off"}
              orientationSource="interface"
              resizeMode="contain"
              style={overlay ? { position: "absolute", ...overlay.camera } : StyleSheet.absoluteFill}
              onStarted={onCameraStarted}
              onStopped={() => { setCameraReady(false); log("info", "camera stopped", {}); }}
              onError={(e) => { setCameraReady(false); log("error", "camera error", e); }}
            />
          )}
          {!device && <View style={[StyleSheet.absoluteFill, s.center]}><Text style={s.noCam}>No back camera found</Text></View>}
          {overlay && <Overlay preview={preview} rect={overlay.rect} settings={settings} exceedsPreview={overlay.exceedsPreview} human={overlay.human} />}
          {sequence && <View style={s.seqBadge} pointerEvents="none"><SeqBadge count={sequence.photos.length} recording /></View>}
          {card && <View style={s.cardWrap} pointerEvents="box-none">{card}</View>}
        </View>
        {hud}
      </View>
      {portrait ? endBars.length > 0 && <View style={s.chrome}>{endBars.map(bar)}</View> : endBars.map((b) => sideBar(b, false, false))}

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
function Control({ icon, label, text, onPress, onLongPress, on, disabled, warn, badge, vertical }: { icon: string; label: string; /** A short label under the icon (layout option). */ text?: string; onPress: () => void; onLongPress?: () => void; on?: boolean; disabled?: boolean; warn?: boolean; badge?: ReactNode; vertical: boolean }) {
  const s = useStyles();
  const { c } = useTheme();
  const fg = disabled ? c.textDisabled : on ? c.onAccent : c.chromeText;
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={500} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on, disabled }}
      style={s.hit}>
      {({ pressed }) => (
        <View style={[s.ctl, vertical ? { width: 56, height: 46 } : { width: 46, height: 56 }, on && { backgroundColor: c.accent, borderColor: c.accent }, warn && { borderColor: c.warn }, pressed && s.ctlPressed, disabled && s.ctlOff]}>
          <Icon name={icon} size={text ? 22 : 26} color={fg} />
          {text ? <Text style={[s.ctlText, { color: fg }]} numberOfLines={1}>{text}</Text> : null}
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
  noCam: { ...type("body", "bold"), color: c.chromeText },
  previewArea: { alignItems: "center", justifyContent: "center" },
  hud: { position: "absolute", top: 8, left: 8, right: 8, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  seqBadge: { position: "absolute", bottom: 12, left: 12 },
  cardWrap: { position: "absolute", left: 12, right: 12, top: 0, bottom: 0, justifyContent: "center" },
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: RADIUS.md, backgroundColor: c.surfaceRaised, borderWidth: BORDER.control, borderColor: c.borderStrong },
  cardTitle: { ...type("body", "bold"), color: c.text },
  cardBody: { ...type("small"), color: c.textDim },
  chrome: { backgroundColor: c.chromeBg, borderColor: c.chromeBorder, borderTopWidth: BORDER.control, paddingTop: VF_SIZES.padStart, paddingHorizontal: 8, paddingBottom: VF_SIZES.padEnd, gap: VF_SIZES.gap },
  chromeTop: { borderTopWidth: 0, borderBottomWidth: BORDER.control },
  side: { backgroundColor: c.chromeBg, borderColor: c.chromeBorder },
  sideStart: { borderRightWidth: BORDER.control },
  sideEnd: { borderLeftWidth: BORDER.control },
  inert: { opacity: 0.85 },
  barV: { flex: 1, flexDirection: "column", alignItems: "center" },
  lensFill: { flex: 1, alignSelf: "stretch", justifyContent: "center", alignItems: "center" },
  lensFit: { justifyContent: "center", alignItems: "center" },
  cellH: { width: 56, alignSelf: "stretch" },
  cellV: { height: 56, alignSelf: "stretch" },
  ctlText: { ...type("caption", "bold"), fontSize: 10, lineHeight: 12 },
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
