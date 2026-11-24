import { useEffect, useState } from "react";
import { AppState, Image, Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Camera as VisionCamera, CommonResolutions, useCameraDevices, useCameraPermission, usePhotoOutput } from "react-native-vision-camera";
import { lenses as lensStore } from "../device";
import type { Lens } from "../lenses";
import { log } from "../log";
import { usePrefs } from "../prefs";
import { useProject } from "../projects";
import { addCapture } from "../media/pipeline";
import { queue, queuedUri, useQueueCounts } from "../media/queue";
import { imageSource } from "../media/cache";
import { openApp } from "../shell/nav";
import { persisted } from "../store";
import { Button, Empty, FIXED, Icon, makeStyles, num, RADIUS, SIZE, toast, type, useTheme, type IconName } from "../ui";
import { registerApp } from "./registry";

/**
 * The camera, the base (docs/rewrite/03-capture.md, ux-5-phone.md): shutter, the phone's real lenses,
 * torch, uploads. A capture is one photo: queued at once and visible in Media; the camera is free
 * again as soon as the picture is taken. The built-in layout follows today's app: held upright, the
 * lens rail above the control row; in landscape the control row stands at the right and the lens
 * rail at the far left. Camera layouts (bars, frames, collection mode) come with step B8.
 */
const lensChoice = persisted<string | null>("cameraLens.v1", null);

function useLastPhoto(projectId: string | undefined) {
  const q = queue.use();
  const last = [...q].reverse().find((x) => x.meta.project_id === projectId);
  return last ? { id: last.id, uri: queuedUri(last) } : null;
}

function Camera({ active }: { active: boolean }) {
  const s = useStyles();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const project = useProject();
  const prefs = usePrefs();
  const perm = useCameraPermission();
  const devices = useCameraDevices();
  const set = lensStore.use();
  const chosen = lensChoice.use();
  const lens: Lens | null = set.lenses.find((l) => l.id === chosen) ?? set.lenses.find((l) => l.main) ?? set.lenses[0] ?? null;
  const camera = devices.find((d) => d.id === lens?.camera) ?? devices.find((d) => d.position === "back") ?? null;
  const output = usePhotoOutput({ targetResolution: CommonResolutions.UHD_4_3, quality: 0.92, qualityPrioritization: "balanced" });
  const [torch, setTorch] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const counts = useQueueCounts();
  const last = useLastPhoto(project?.id);

  useEffect(() => { const sub = AppState.addEventListener("change", (st) => setForeground(st === "active")); return () => sub.remove(); }, []);
  useEffect(() => { if (active && !perm.hasPermission && perm.canRequestPermission) void perm.requestPermission(); }, [active, perm.hasPermission, perm.canRequestPermission]);
  useEffect(() => { if (!active) setTorch(false); }, [active]);

  /** One photo: the camera's JPEG is in hand within a moment; making the preview and queuing runs on behind. */
  async function shoot() {
    if (!ready || busy || !project) return;
    setBusy(true);
    setFlash(true); setTimeout(() => setFlash(false), 120);
    const t0 = Date.now();
    try {
      const photo = await output.capturePhoto({ flashMode: "off", enableShutterSound: false }, {});
      let bytes: Uint8Array, size: { width: number; height: number };
      try { bytes = new Uint8Array(await photo.getFileDataAsync()); size = { width: photo.width, height: photo.height }; } finally { photo.dispose(); }
      log("info", "photo taken", { ms: Date.now() - t0, size, bytes: bytes.length, lens: lens?.name });
      setBusy(false);
      await addCapture(project.id, bytes, size, lens);
    } catch (e) {
      log("error", "capture failed", e);
      toast("The photo could not be taken", "danger");
      setBusy(false);
    }
  }

  if (!perm.hasPermission) {
    return (
      <View style={s.blank}>
        <Empty icon="camera" title="Camera access needed" body="OpenClapper takes photos with the phone's camera.">
          <Button label="Allow the camera" icon="camera" onPress={() => { if (perm.canRequestPermission) void perm.requestPermission(); else void Linking.openSettings(); }} />
        </Empty>
      </View>
    );
  }

  const lensLabel = (l: Lens) => (prefs.lensNames === "focal" && l.focal35 ? `${Math.round(l.focal35)}` : l.name);
  const rail = set.lenses.length > 1 && (
    <View style={[s.rail, landscape && s.railSide]}>
      {set.lenses.map((l) => (
        <CamButton key={l.id} label={`Lens ${l.name}${l.focal35 ? `, ${l.focal35} mm` : ""}`} on={l.id === lens?.id} onPress={() => lensChoice.set(l.id)} text={lensLabel(l)} />
      ))}
    </View>
  );
  const controls = (
    <View style={[s.controls, landscape && s.controlsSide]}>
      <CamButton icon={counts.stuck ? "warning" : "cloud-upload"} label={`Uploads: ${counts.waiting} waiting`} text={counts.waiting ? String(counts.waiting) : undefined} warn={counts.stuck > 0}
        onPress={() => openApp("setup", "uploads")} />
      <Pressable accessibilityRole="button" accessibilityLabel="Last photo" disabled={!last} onPress={() => last && openApp("media", last.id)} style={s.thumb}>
        {last && <Image source={last.uri ? { uri: last.uri } : imageSource(last.id, "thumbnail")} style={StyleSheet.absoluteFill} />}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Take a photo" disabled={!ready || busy} onPress={() => void shoot()}
        style={({ pressed }) => [s.shutter, pressed && { transform: [{ scale: 0.94 }] }, (!ready || busy) && { opacity: 0.6 }]}>
        <View style={s.shutterInner} />
      </Pressable>
      <CamButton icon="flashlight" label="Torch" on={torch} disabled={!set.torch} onPress={() => setTorch((t) => !t)} />
      <View style={s.gap} />
    </View>
  );

  return (
    <View style={[s.root, landscape && { flexDirection: "row" }]}>
      {landscape && rail}
      <View style={s.view}>
        {camera ? (
          <VisionCamera
            device={camera}
            isActive={active && foreground}
            outputs={[output]}
            zoom={lens?.cameraZoom ?? 1}
            torchMode={torch && active && set.torch ? "on" : "off"}
            orientationSource="interface"
            resizeMode="contain"
            style={StyleSheet.absoluteFill}
            onStarted={() => { setReady(true); log("info", "camera started", { camera: camera.id, lens: lens?.name, zoom: lens?.cameraZoom }); }}
            onStopped={() => setReady(false)}
            onError={(e) => { setReady(false); log("error", "camera error", e); }}
          />
        ) : <View style={[StyleSheet.absoluteFill, s.center]}><Text style={s.hud}>No back camera found</Text></View>}
        {flash && <View style={[StyleSheet.absoluteFill, { backgroundColor: FIXED.black }]} />}
        <View style={s.hudRow} pointerEvents="none">
          <Text style={s.hud} numberOfLines={1}>{project?.name ?? ""}{lens ? ` · ${lens.focal35 ? `${lens.focal35} mm lens` : `${lens.name} lens`}` : ""}</Text>
        </View>
      </View>
      {!landscape && rail}
      {controls}
    </View>
  );
}

/** A camera control (ux-5-phone.md): outlined when off, filled in the accent colour when on; with text it is a pill. */
function CamButton({ icon, text, label, on, warn, disabled, onPress }: { icon?: IconName; text?: string; label: string; on?: boolean; warn?: boolean; disabled?: boolean; onPress: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const fg = on ? c.onAccent : disabled ? "rgba(255,255,255,.4)" : FIXED.white;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on, disabled }}
      style={({ pressed }) => [s.cam, text !== undefined && s.camPill, on && { backgroundColor: c.accent, borderColor: c.accent }, warn && { borderColor: FIXED.record }, pressed && !on && { backgroundColor: "rgba(255,255,255,.16)" }]}>
      {icon && <Icon name={icon} size={22} color={warn ? FIXED.record : fg} />}
      {text !== undefined && <Text style={[s.camText, { color: fg }]}>{text}</Text>}
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  root: { flex: 1, backgroundColor: FIXED.photoBg },
  blank: { flex: 1, justifyContent: "center" },
  view: { flex: 1, overflow: "hidden" },
  center: { alignItems: "center", justifyContent: "center" },
  hudRow: { position: "absolute", top: 8, left: 8, right: 8, flexDirection: "row" },
  hud: { ...type("caption", "bold"), color: FIXED.white, backgroundColor: FIXED.glass, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.xs, overflow: "hidden", ...num },
  rail: { flexDirection: "row", justifyContent: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12 },
  railSide: { flexDirection: "column", paddingVertical: 12, paddingHorizontal: 8 },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingVertical: 12, paddingHorizontal: 12 },
  controlsSide: { flexDirection: "column-reverse", paddingVertical: 12, paddingHorizontal: 10 },
  gap: { width: SIZE.touchMin, height: SIZE.touchMin },
  thumb: { width: SIZE.touchMin, height: SIZE.touchMin, borderRadius: RADIUS.sm, overflow: "hidden", borderWidth: 2, borderColor: "rgba(255,255,255,.5)", backgroundColor: "rgba(255,255,255,.08)" },
  shutter: { width: SIZE.shutter, height: SIZE.shutter, borderRadius: SIZE.shutter / 2, borderWidth: 4, borderColor: FIXED.white, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: SIZE.shutter - 16, height: SIZE.shutter - 16, borderRadius: (SIZE.shutter - 16) / 2, backgroundColor: FIXED.white },
  cam: { minWidth: SIZE.touchMin, height: SIZE.touchMin, borderRadius: SIZE.touchMin / 2, borderWidth: 2, borderColor: "rgba(255,255,255,.7)", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 },
  camPill: { paddingHorizontal: 14 },
  camText: { ...type("label", "bold"), ...num },
}));

registerApp({ id: "camera", label: "Camera", icon: "camera", needsProject: true, Screen: Camera });
