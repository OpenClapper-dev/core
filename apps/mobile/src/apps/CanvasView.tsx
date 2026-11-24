import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Text, useWindowDimensions, View } from "react-native";
import { WebView } from "react-native-webview";
import { aspectFrame, opticsFrame } from "@openclapper/fov-math";
import { frameOptics, type CanvasBody, type PresetBody } from "@openclapper/model";
import { authHeaders, canvasImageUrl, getFile, webUrl, type FileRec } from "../api";
import { libraryFile, loadLibrary } from "../media/library";
import { useBack } from "../shell/back";
import { Block, Button, FIXED, Header, Hint, makeStyles, Screen, Seg, type, useTheme } from "../ui";

/**
 * A canvas on the phone (docs/features/canvas.md): its render, with the view modes of a canvas that has a
 * picture (Full, Crop, Mask, Outline; the screen's choice, never stored), and the editor itself, the
 * Studio's, in a web view (the tablet's way to draw).
 */
type Mode = "full" | "crop" | "mask" | "outline";
interface Rect { x: number; y: number; w: number; h: number }

/** Where the picture frame is on the surface, in fractions; null without a picture, or one that cannot be drawn or does not fit. */
function pictureRect(body: CanvasBody, base: FileRec | null, presets: ReadonlyMap<string, PresetBody>): Rect | null {
  const f = body.frames.find((x) => x.id === body.picture && x.visible);
  if (!f || body.surface.kind !== "photo" || !base?.photo) return null;
  const aspect = base.photo.width / base.photo.height;
  let size: { w: number; h: number; inner: { w: number; h: number } | null } | null = null;
  if (f.kind === "aspect") size = aspectFrame(f.aspect ?? 2.39, f.size ?? 0.8, aspect);
  else {
    const o = frameOptics(f, presets), v = base.photo.angle_of_view;
    if (o && v) size = opticsFrame(o, v);
  }
  if (!size) return null;
  const box = size.inner ?? size;
  if (box.w > 1 || box.h > 1) return null;
  return { x: f.cx - box.w / 2, y: f.cy - box.h / 2, w: box.w, h: box.h };
}

export function CanvasPage({ canvas, presets, back, onEdit }: { canvas: FileRec; presets: ReadonlyMap<string, PresetBody>; back: () => void; onEdit: () => void }) {
  const s = useStyles();
  const { width, height } = useWindowDimensions();
  const [body, setBody] = useState<CanvasBody | null>(null);
  const [baseId, setBaseId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("crop");
  const [failed, setFailed] = useState(false);
  useEffect(() => { getFile(canvas.id).then((f) => { setBody(f.body as unknown as CanvasBody); setBaseId(((f as FileRec & { refs?: { kind: string; to: string }[] }).refs ?? []).find((r) => r.kind === "base")?.to ?? null); }, () => setFailed(true)); }, [canvas.id, canvas.updated_at]);
  const base = baseId ? libraryFile(baseId) : null;
  const aspect = body ? (body.surface.kind === "photo" ? (base?.photo ? base.photo.width / base.photo.height : 4 / 3) : body.surface.aspect) : 4 / 3;
  const pic = body ? pictureRect(body, base, presets) : null;
  const shown: Mode = pic ? mode : "full";
  // The box on screen: the whole surface, or (Crop) the picture's frame, as large as fits.
  const maxW = width - 32, maxH = height * 0.6;
  const boxAspect = shown === "crop" && pic ? (pic.w * aspect) / pic.h : aspect;
  const bw = Math.min(maxW, maxH * boxAspect), bh = bw / boxAspect;
  const img = { uri: canvasImageUrl(canvas, "render"), headers: authHeaders() };
  const surfaceW = shown === "crop" && pic ? bw / pic.w : bw, surfaceH = surfaceW / aspect;
  return (
    <Screen header={<Header title={canvas.name} sub="Canvas" onBack={back} actions={[{ icon: "brush", label: "Edit the canvas", onPress: onEdit }]} />}>
      <View style={{ alignItems: "center", paddingVertical: 16 }}>
        <View style={{ width: bw, height: bh, overflow: "hidden", backgroundColor: FIXED.photoBg }}>
          <Image source={img} onError={() => setFailed(true)} style={{ position: "absolute", width: surfaceW, height: surfaceH, left: shown === "crop" && pic ? -pic.x * surfaceW : 0, top: shown === "crop" && pic ? -pic.y * surfaceH : 0 }} />
          {pic && shown === "mask" && <>
            <View style={[s.dim, { left: 0, top: 0, width: bw, height: pic.y * bh }]} />
            <View style={[s.dim, { left: 0, top: (pic.y + pic.h) * bh, width: bw, height: (1 - pic.y - pic.h) * bh }]} />
            <View style={[s.dim, { left: 0, top: pic.y * bh, width: pic.x * bw, height: pic.h * bh }]} />
            <View style={[s.dim, { left: (pic.x + pic.w) * bw, top: pic.y * bh, width: (1 - pic.x - pic.w) * bw, height: pic.h * bh }]} />
          </>}
          {pic && (shown === "mask" || shown === "outline") && <View style={[s.frame, { left: pic.x * bw, top: pic.y * bh, width: pic.w * bw, height: pic.h * bh }]} />}
        </View>
      </View>
      {pic && <Block><Seg block options={[{ id: "crop", label: "Crop" }, { id: "mask", label: "Mask" }, { id: "outline", label: "Outline" }, { id: "full", label: "Full" }]} value={mode} onChange={setMode} accessibilityLabel="View mode" /></Block>}
      {!body && !failed && <ActivityIndicator style={{ marginTop: 16 }} />}
      {failed && <Block><Hint>The canvas could not be loaded, or it has no render yet (it is made when the canvas is saved). It needs a connection.</Hint></Block>}
      <Block><Button kind="secondary" icon="brush" label="Edit the canvas" onPress={onEdit} /></Block>
    </Screen>
  );
}

/**
 * The Studio's canvas editor in a web view (05-composition.md: the embedded way first). The web view
 * opens /api/web with this session as a bearer header; the server sets the same session as a cookie and
 * sends it on to the editor page. Back closes it; the editor saves on its own and lets the lock go.
 */
export function CanvasWeb({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  const { name: theme } = useTheme();
  const s = useStyles();
  const [error, setError] = useState<string | null>(null);
  const close = () => { void loadLibrary(); onClose(); };
  useBack(close);
  return (
    <View style={{ flex: 1 }}>
      <Header title={name} sub="Canvas · saves on its own" onBack={close} />
      {error ? <Block><Text style={s.err}>{error}</Text><Hint>The editor needs a connection to the server.</Hint></Block> : (
        <WebView source={{ uri: webUrl(`/#/embed/canvas/${id}?theme=${theme}`), headers: authHeaders() }} style={{ flex: 1 }} sharedCookiesEnabled thirdPartyCookiesEnabled={false}
          setSupportMultipleWindows={false} startInLoadingState renderLoading={() => <ActivityIndicator style={{ marginTop: 32 }} />}
          onError={(e) => setError(e.nativeEvent.description || "The editor could not be opened")} onHttpError={(e) => setError(`The server answered ${e.nativeEvent.statusCode}`)} />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  dim: { position: "absolute", backgroundColor: FIXED.mask },
  frame: { position: "absolute", borderWidth: 2, borderColor: FIXED.white },
  err: { ...type("body", "semibold"), color: c.danger },
}));
