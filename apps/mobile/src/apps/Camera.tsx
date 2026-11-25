import { useEffect, useMemo, useState } from "react";
import { randomUUID } from "expo-crypto";
import { AppState, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Camera as VisionCamera, CommonResolutions, useCameraDevices, useCameraPermission, usePhotoOutput } from "react-native-vision-camera";
import { DELIVERIES, FORMATS, PRIMES, opticsFrame } from "@openclapper/fov-math";
import { CONTROLS, focalsOf, REFERENCE_STEPS, type Bar, type ControlId, type Distribution, type Edge, type LayoutBody, type LayoutItem, type PresetBody } from "@openclapper/model";
import { canCall, putFile } from "../api";
import { lenses as lensStore, measureCamera } from "../device";
import type { Lens } from "../lenses";
import { leavePreview } from "../link";
import { log } from "../log";
import { libraryFile, loadLibrary, useLibrary, usePresets } from "../media/library";
import { addCapture } from "../media/pipeline";
import { imageSource } from "../media/cache";
import { queue, queuedUri, useQueueCounts } from "../media/queue";
import { usePrefs } from "../prefs";
import { useExtensionsOn, useProject } from "../projects";
import { cameraControlView } from "../camera/controls";
import { openApp } from "../shell/nav";
import { persisted } from "../store";
import { allLayouts, chooseLayout, useLayout } from "../camera/layouts";
import { captureFact, collecting, endCollection, frameBox, frames, liveView, nextFolder, startCollection, toggles, type FrameChoice } from "../camera/state";
import { Button, Empty, FIXED, Hint, Icon, ListRow, makeStyles, num, RADIUS, SectionLabel, Seg, Sheet, SheetList, SIZE, Slider, toast, type, useTheme, Block, type IconName } from "../ui";
import { registerApp } from "./registry";
import { useCameraButtons } from "../settings";

/**
 * The camera (docs/features/camera-layouts.md, docs/rewrite/03-capture.md): the phone takes photos; everything else
 * is a control of the camera layout in use, in its bars around the picture or over it. A capture is one photo, queued
 * at once; with a frame on the screen the photo keeps it as a fact; collection mode and the folder for new photos
 * say where it goes. The live angle of view comes only from what the camera reports for the lens in use.
 */
const lensChoice = persisted<string | null>("cameraLens.v1", null);
const sideways = (e: Edge) => e === "left" || e === "right";
const JUSTIFY: Record<Distribution, "flex-start" | "center" | "flex-end" | "space-between" | "space-around"> = { start: "flex-start", center: "center", end: "flex-end", between: "space-between", around: "space-around" };

function Camera({ active }: { active: boolean }) {
  const sizes = useCameraButtons();
  const s = useStyles();
  const { width, height } = useWindowDimensions();
  const project = useProject();
  const prefs = usePrefs();
  const perm = useCameraPermission();
  const devices = useCameraDevices();
  const set = lensStore.use();
  const chosen = lensChoice.use();
  const presets = usePresets();
  const lib = useLibrary();
  const { layout, preview, orientation } = useLayout();
  const body: LayoutBody = layout.body;
  const landscape = orientation ? orientation === "landscape" : width > height;
  const arrangement = landscape ? body.landscape : body.portrait;
  const placed = useMemo(() => new Set(arrangement.bars.flatMap((b) => b.items.map((i) => i.control))), [arrangement]);

  // The lenses this layout offers, named as it says.
  const names = body.options.lensNames === "account" ? prefs.lensNames : body.options.lensNames;
  const offered = body.options.lenses.mode === "main" ? set.lenses.filter((l) => l.main).slice(0, 1) : body.options.lenses.mode === "pick" ? set.lenses.filter((l) => body.options.lenses.pick.includes(l.id)) : set.lenses;
  const lensList = offered.length ? offered : set.lenses.filter((l) => l.main).slice(0, 1);
  const lens: Lens | null = lensList.find((l) => l.id === chosen) ?? lensList.find((l) => l.main) ?? lensList[0] ?? set.lenses[0] ?? null;
  const lensLabel = (l: Lens) => (names === "focal" && l.focal35 ? `${Math.round(l.focal35)}` : l.name);
  const camera = devices.find((d) => d.id === lens?.camera) ?? devices.find((d) => d.position === "back") ?? null;
  // Full quality (#426): the sensor's largest 4:3 picture, the least compression; the original is stored untouched.
  const output = usePhotoOutput({ targetResolution: CommonResolutions.HIGHEST_4_3, quality: 1, qualityPrioritization: "quality" });
  const [torch, setTorch] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const [sheet, setSheet] = useState<"frame" | "folder" | "layout" | "name-start" | "name-end" | null>(null);
  // An extension's control open over the camera (its own sheet).
  const [extOpen, setExtOpen] = useState<string | null>(null);
  const extensionsOn = useExtensionsOn();
  const [viewBox, setViewBox] = useState({ w: 0, h: 0 });
  const counts = useQueueCounts();
  const q = queue.use();
  const last = [...q].reverse().find((x) => x.meta.project_id === project?.id);
  const tg = toggles.use();
  const frameOf = frames.use();
  const coll = collecting.use();
  const folders = nextFolder.use();
  const frame = (project && frameOf[project.id]) ?? null;
  const folder = (project && folders[project.id]) ?? null;
  const mode = coll && coll.project === project?.id ? coll : null;

  useEffect(() => { const sub = AppState.addEventListener("change", (st) => setForeground(st === "active")); return () => sub.remove(); }, []);
  useEffect(() => { if (active && !perm.hasPermission && perm.canRequestPermission) void perm.requestPermission(); }, [active, perm.hasPermission, perm.canRequestPermission]);
  useEffect(() => { if (!active) setTorch(false); }, [active]);

  // The frame's geometry: the live picture is 4:3 (3:4 upright), its angle of view the lens's report.
  const picAspect = landscape ? 4 / 3 : 3 / 4;
  const view = liveView(lens?.focal35, !landscape);
  const blackout = tg.blackout ?? body.look.blackoutOn;
  const box = frameBox(placed.has("frame") || placed.has("focal") ? frame : null, presets, view, picAspect, tg.upright);
  const opticsWithoutView = !!frame && frame.kind !== "aspect" && !view;
  const pw = Math.min(viewBox.w, viewBox.h * picAspect), ph = pw / picAspect;
  const fw = box ? box.w * pw : 0, fh = box ? box.h * ph : 0;
  const container = !!box && (box.w > 1.001 || box.h > 1.001);
  // Zoom to frame enlarges the picture on the screen only; a frame wider than the lens is the container: the picture sits smaller inside it.
  const scale = box && (container || (tg.fit && placed.has("fit"))) && fw > 0 && fh > 0 ? Math.min(viewBox.w / fw, viewBox.h / fh) : 1;
  const ref = placed.has("reference") && tg.reference && view ? opticsFrame({ format: [36, 24], multiplier: 1, squeeze: 1, delivery: null, focal: tg.reference, portrait: !landscape }, view) : null;

  /** One photo: the camera's JPEG is in hand within a moment; making the preview and queuing runs on behind. */
  async function shoot() {
    if (!ready || busy || !project || preview) return;
    setBusy(true);
    setFlash(true); setTimeout(() => setFlash(false), 120);
    const t0 = Date.now();
    try {
      const photo = await output.capturePhoto({ flashMode: "off", enableShutterSound: false }, {});
      let bytes: Uint8Array, size: { width: number; height: number };
      try { bytes = new Uint8Array(await photo.getFileDataAsync()); size = { width: photo.width, height: photo.height }; } finally { photo.dispose(); }
      log("info", "photo taken", { ms: Date.now() - t0, size, bytes: bytes.length, lens: lens?.name });
      setBusy(false);
      const names = new Map([...presets.keys()].map((id) => [id, libraryFile(id)?.name ?? ""]));
      const fact = box && frame ? captureFact(frame, presets, names, tg.upright, picAspect) : null;
      await addCapture(project.id, bytes, size, lens, { container: mode?.id ?? folder, frame: fact as Record<string, unknown> | null });
      if (mode) collecting.set({ ...mode, count: mode.count + 1 });
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

  // ---------- The controls ----------
  const preset = frame?.kind === "preset" ? presets.get(frame.preset) : undefined;
  const focals = frame?.kind === "preset" && preset ? focalsOf(preset.lenses) : frame?.kind === "free" ? [...PRIMES] : [];
  const setFocal = (mm: number) => project && frame && frame.kind !== "aspect" && frames.set((f) => ({ ...f, [project.id]: { ...frame, focal: mm } as FrameChoice }));
  const cycleRef = () => {
    const r = body.options.reference;
    if (r.mode === "toggle") toggles.set((t) => ({ ...t, reference: t.reference ? null : r.mm }));
    else toggles.set((t) => { const steps = [...REFERENCE_STEPS] as number[], i = t.reference ? steps.indexOf(t.reference) : -1; return { ...t, reference: i + 1 < steps.length ? steps[i + 1] : null }; });
  };
  const collectionTap = () => {
    if (!project) return;
    if (mode) { if (prefs.askCollectionName === "end") setSheet("name-end"); else void endCollection(); return; }
    if (prefs.askCollectionName === "start") setSheet("name-start"); else void startCollection(project.id, folder);
  };
  const readout = (c: ControlId): { text: string; warn?: boolean } | null => {
    switch (c) {
      case "read-project": return project ? { text: project.name } : null;
      case "read-lens": return lens ? { text: lens.focal35 ? `${lensLabel(lens)}${names === "focal" ? " mm" : ""} · ${Math.round(lens.focal35)} mm eq.` : lensLabel(lens) } : null;
      case "read-frame": return frame ? { text: frame.kind === "aspect" ? `${Number(frame.aspect.toFixed(2))}:1` : `${frame.kind === "preset" ? `${libraryFile(frame.preset)?.name ?? "Preset"} · ` : ""}${frame.focal} mm${tg.upright ? " · upright" : ""}` } : null;
      case "read-fov": return view ? { text: `${Math.round(view.horizontal)}° × ${Math.round(view.vertical)}°` } : null;
      case "read-collection": return mode ? { text: `${mode.name} · ${mode.count}` } : null;
      case "read-folder": return { text: folder ? libraryFile(folder)?.name ?? "A folder" : "Top level" };
      case "read-warnings": {
        const w = container ? "Frame wider than the lens" : opticsWithoutView ? "This lens reports no focal length: no optics frame" : !project ? "No project" : null;
        return w ? { text: w, warn: true } : null;
      }
      default: return null;
    }
  };
  const control = (i: LayoutItem, vertical: boolean) => {
    const c = CONTROLS[i.control];
    // Unknown here (a newer layout), or an extension's control while the project has it off: left out.
    if (!c || (c.extension && !extensionsOn.includes(c.extension))) return null;
    if (c.kind === "readout") { const r = readout(i.control); return r ? <Text key={i.control} style={[s.tag, r.warn && s.tagWarn]} numberOfLines={1}>{r.text}</Text> : null; }
    if (c.kind === "shutter") return (
      <Pressable key="shutter" accessibilityRole="button" accessibilityLabel="Take a photo" disabled={!ready || busy || preview} onPress={() => void shoot()}
        style={({ pressed }) => [s.shutter, { width: sizes.shutter, height: sizes.shutter, borderRadius: sizes.shutter / 2 }, pressed && { transform: [{ scale: 0.94 }] }, (!ready || busy) && { opacity: 0.6 }]}><View style={[s.shutterInner, { width: sizes.shutter - 16, height: sizes.shutter - 16, borderRadius: (sizes.shutter - 16) / 2 }]} /></Pressable>
    );
    if (i.control === "lenses") {
      if (lensList.length < 2) return null;
      const strip = lensList.map((l) => <CamButton key={l.id} label={`Lens ${l.name}${l.focal35 ? `, ${l.focal35} mm` : ""}`} on={l.id === lens?.id} onPress={() => lensChoice.set(l.id)} text={lensLabel(l)} />);
      if (i.display === "stepped") return <Stepped key="lenses" vertical={vertical} value={lens ? lensLabel(lens) : "–"} label="Lens" onStep={(d) => { const k = lensList.findIndex((l) => l.id === lens?.id), n = lensList[k + d]; if (n) lensChoice.set(n.id); }} />;
      return i.size === "fill"
        ? <ScrollView key="lenses" horizontal={!vertical} style={{ flex: 1 }} contentContainerStyle={[s.strip, vertical && s.stripV]}>{strip}</ScrollView>
        : <View key="lenses" style={[s.strip, vertical && s.stripV]}>{strip}</View>;
    }
    if (i.control === "focal") {
      if (!frame || frame.kind === "aspect") return null;
      if (preset?.lenses.kind === "zoom") return <View key="focal" style={{ width: vertical ? 64 : 220 }}><Slider label="Focal length" value={frame.focal} min={preset.lenses.from} max={preset.lenses.to} format={(v) => `${v} mm`} onChange={setFocal} /></View>;
      if (i.display === "stepped" || frame.kind === "free") return <Stepped key="focal" vertical={vertical} value={`${frame.focal}`} label="Focal length" onStep={(d) => { const k = focals.indexOf(frame.focal), n = focals[k < 0 ? 0 : k + d]; if (n) setFocal(n); }} />;
      return <View key="focal" style={[s.strip, vertical && s.stripV]}>{focals.map((mm) => <CamButton key={mm} label={`${mm} mm`} on={mm === frame.focal} onPress={() => setFocal(mm)} text={String(mm)} />)}</View>;
    }
    const btn = (on: boolean | undefined, press: () => void, extra: { text?: string; warn?: boolean; disabled?: boolean } = {}) => (
      <View key={i.control} style={s.ctl}>
        <CamButton icon={c.icon as IconName} label={c.label} on={on} onPress={press} {...extra} />
        {i.label && "short" in c && <Text style={s.ctlLabel}>{c.short}</Text>}
      </View>
    );
    switch (i.control) {
      case "frame": return btn(!!frame, () => setSheet("frame"));
      case "fit": return btn(tg.fit, () => toggles.set((t) => ({ ...t, fit: !t.fit })), { disabled: !box });
      case "blackout": return btn(blackout, () => toggles.set((t) => ({ ...t, blackout: !blackout })), { disabled: !box });
      case "upright": return btn(tg.upright, () => toggles.set((t) => ({ ...t, upright: !t.upright })), { disabled: !frame || frame.kind === "aspect" });
      case "reference": return btn(!!tg.reference, cycleRef, { text: tg.reference ? String(tg.reference) : undefined, disabled: !view });
      case "collection": return btn(!!mode, collectionTap, { text: mode ? String(mode.count) : undefined });
      case "folder": return btn(!!folder, () => setSheet("folder"));
      case "torch": return btn(torch, () => setTorch((t) => !t), { disabled: !set.torch });
      case "layout": return btn(undefined, () => setSheet("layout"));
      case "uploads": return btn(undefined, () => openApp("setup", "uploads"), { text: counts.waiting ? String(counts.waiting) : undefined, warn: counts.stuck > 0 });
      case "last": return (
        <Pressable key="last" accessibilityRole="button" accessibilityLabel="Last photo" disabled={!last} onPress={() => last && openApp("media", last.id)} style={[s.thumb, { width: sizes.size, height: sizes.size }]}>
          {last && <Image source={queuedUri(last) ? { uri: queuedUri(last)! } : imageSource(last.id, "thumbnail")} style={StyleSheet.absoluteFill} />}
        </Pressable>
      );
      default: return cameraControlView(i.control) ? btn(extOpen === i.control, () => setExtOpen(i.control)) : null;
    }
  };
  const drawBar = (b: Bar) => {
    const v = sideways(b.edge);
    return (
      <View key={b.id} pointerEvents={preview ? "none" : "auto"} style={[s.bar, v ? s.barV : s.barH, b.over && s.barOver, preview && { opacity: 0.85 }, { justifyContent: JUSTIFY[b.distribution] }, b.items.some((x) => x.control === "shutter") && (v ? { minWidth: 96 } : { minHeight: 96 })]}>
        {b.items.map((i) => control(i, v))}
      </View>
    );
  };
  const at = (e: Edge) => arrangement.bars.filter((b) => b.edge === e && !b.over).map(drawBar);
  const overAt = (e: Edge) => { const bs = arrangement.bars.filter((b) => b.edge === e && b.over); return bs.length ? <View key={e} pointerEvents="box-none" style={[s.over, s[`over_${e}`]]}>{bs.map(drawBar)}</View> : null; };

  // ---------- The picture with its frames ----------
  const rect = (w: number, h: number) => ({ position: "absolute" as const, left: (viewBox.w - w) / 2, top: (viewBox.h - h) / 2, width: w, height: h });
  const fr = box ? { w: fw * scale, h: fh * scale } : null;
  const inner = box?.inner && fr ? { w: (box.inner.w / box.w) * fr.w, h: (box.inner.h / box.h) * fr.h } : null;
  const shown = inner ?? fr;
  const picture = (
    <View style={s.view} onLayout={(e: LayoutChangeEvent) => setViewBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <View style={[StyleSheet.absoluteFill, { transform: [{ scale }] }]}>
        {camera ? (
          <VisionCamera device={camera} isActive={active && foreground} outputs={[output]} zoom={lens?.cameraZoom ?? 1} torchMode={torch && active && set.torch ? "on" : "off"}
            orientationSource="interface" resizeMode="contain" style={StyleSheet.absoluteFill}
            onStarted={() => { setReady(true); log("info", "camera started", { camera: camera.id, lens: lens?.name, zoom: lens?.cameraZoom }); }}
            onStopped={() => setReady(false)} onError={(e) => { setReady(false); log("error", "camera error", e); }} />
        ) : <View style={[StyleSheet.absoluteFill, s.center]}><Text style={s.tag}>No back camera found</Text></View>}
      </View>
      {shown && blackout && <Blackout box={rect(shown.w, shown.h)} w={viewBox.w} h={viewBox.h} color={body.look.blackoutColor} />}
      {fr && <View pointerEvents="none" style={[rect(fr.w, fr.h), { borderWidth: body.look.frameWidth, borderColor: body.look.frameColor, borderStyle: container ? "dashed" : "solid" }]} />}
      {inner && <View pointerEvents="none" style={[rect(inner.w, inner.h), { borderWidth: 1, borderColor: body.look.frameColor, borderStyle: "dashed" }]} />}
      {ref && <View pointerEvents="none" style={[rect(ref.w * pw * scale, ref.h * ph * scale), { borderWidth: 2, borderColor: FIXED.human, borderStyle: "dashed" }]} />}
      {flash && <View style={[StyleSheet.absoluteFill, { backgroundColor: FIXED.black }]} />}
      {(["top", "bottom", "left", "right"] as Edge[]).map(overAt)}
      {preview && (
        <Pressable onPress={leavePreview} style={s.previewChip} accessibilityRole="button" accessibilityLabel="Leave the Studio's preview">
          <Icon name="eye" size={14} color={FIXED.black} /><Text style={s.previewText}>Studio preview · buttons off · tap to leave</Text>
        </Pressable>
      )}
    </View>
  );
  const measure = (e: LayoutChangeEvent) => { if (!preview) measureCamera(landscape, e.nativeEvent.layout.width, e.nativeEvent.layout.height); };
  return (
    <View style={[s.root, landscape && { flexDirection: "row" }]} onLayout={measure}>
      {landscape ? at("left") : at("top")}
      <View style={[s.mid, landscape && { flexDirection: "column" }]}>
        {landscape ? at("top") : at("left")}
        {picture}
        {landscape ? at("bottom") : at("right")}
      </View>
      {landscape ? at("right") : at("bottom")}
      {sheet === "frame" && project && <FrameSheet project={project.id} current={frame} presets={presets} onClose={() => setSheet(null)} />}
      {sheet === "folder" && project && <FolderSheet project={project.id} current={folder} folders={lib.holders.filter((h) => h.type === "folder")} onClose={() => setSheet(null)} />}
      {sheet === "layout" && <LayoutSheet current={layout.id} onClose={() => setSheet(null)} />}
      {extOpen && (() => { const V = cameraControlView(extOpen)?.Sheet; return V ? <V onClose={() => setExtOpen(null)} /> : null; })()}
      {(sheet === "name-start" || sheet === "name-end") && project && <NameSheet title={sheet === "name-start" ? "A name for the new collection" : `A name for “${mode?.name ?? "the collection"}”`} initial={sheet === "name-end" ? mode?.name ?? "" : ""}
        onClose={() => setSheet(null)} onDone={(n) => { setSheet(null); if (sheet === "name-start") void startCollection(project.id, folder, n || undefined); else void endCollection(n); }} />}
    </View>
  );
}

/** Darkens outside the frame: four rectangles around it, in the layout's tint. */
function Blackout({ box, w, h, color }: { box: { left: number; top: number; width: number; height: number }; w: number; h: number; color: string }) {
  const r = { position: "absolute" as const, backgroundColor: color };
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[r, { left: 0, top: 0, width: w, height: Math.max(0, box.top) }]} />
      <View style={[r, { left: 0, top: box.top + box.height, width: w, height: Math.max(0, h - box.top - box.height) }]} />
      <View style={[r, { left: 0, top: box.top, width: Math.max(0, box.left), height: box.height }]} />
      <View style={[r, { left: box.left + box.width, top: box.top, width: Math.max(0, w - box.left - box.width), height: box.height }]} />
    </View>
  );
}

/** A strip shown one value at a time: back, the value, on; three parts a thumb can hit, stacked in an upright bar. */
function Stepped({ vertical, value, label, onStep }: { vertical: boolean; value: string; label: string; onStep: (d: -1 | 1) => void }) {
  const s = useStyles();
  return (
    <View style={[s.stepped, vertical && { flexDirection: "column" }]}>
      <CamButton icon={vertical ? "chevron-up" : "chevron-left"} label={`Previous ${label}`} onPress={() => onStep(-1)} />
      <Text style={s.steppedValue}>{value}</Text>
      <CamButton icon={vertical ? "chevron-down" : "chevron-right"} label={`Next ${label}`} onPress={() => onStep(1)} />
    </View>
  );
}

/** The frame on the camera: a preset of the project and its focal length, free-form values, an aspect ratio, or none (kept per project). */
function FrameSheet({ project, current, presets, onClose }: { project: string; current: FrameChoice | null; presets: ReadonlyMap<string, PresetBody>; onClose: () => void }) {
  const [tab, setTab] = useState<"preset" | "free" | "aspect">(current?.kind ?? "preset");
  const [free, setFree] = useState(current?.kind === "free" ? current : { kind: "free" as const, format: [24.89, 13.87] as [number, number], multiplier: 1, squeeze: 1, delivery: null as number | null, focal: 35 });
  const pick = (f: FrameChoice | null) => { frames.set((all) => ({ ...all, [project]: f })); onClose(); };
  const live = [...presets.entries()].filter(([, b]) => !b.archived);
  return (
    <Sheet visible title="Frame" sub="What the camera shows on the picture" onClose={onClose}>
      <Block><Seg block options={[{ id: "preset", label: "Preset" }, { id: "free", label: "Free" }, { id: "aspect", label: "Aspect" }]} value={tab} onChange={setTab} accessibilityLabel="Kind of frame" /></Block>
      <SheetList>
        {current && <ListRow icon="close" title="No frame" trailing={null} onPress={() => pick(null)} />}
        {tab === "preset" && (live.length ? live.map(([id, b]) => (
          <ListRow key={id} icon="lens" title={libraryFile(id)?.name ?? "Preset"} meta={`${b.format[0]} × ${b.format[1]} mm · ${b.lenses.kind === "primes" ? b.lenses.primes.join(", ") : `${b.lenses.from}–${b.lenses.to}`} mm`} selected={current?.kind === "preset" && current.preset === id} trailing={null}
            onPress={() => pick({ kind: "preset", preset: id, focal: current?.kind === "preset" && current.preset === id ? current.focal : focalsOf(b.lenses)[0] })} />
        )) : <Block><Hint>No optics presets in this project yet. They are made in the Studio (Optics presets).</Hint></Block>)}
        {tab === "free" && (
          <>
            <Block><SectionLabel>Format</SectionLabel></Block>
            {FORMATS.map((x) => <ListRow key={x.name} title={x.name} meta={`${x.w} × ${x.h} mm`} selected={free.format[0] === x.w && free.format[1] === x.h} trailing={null} onPress={() => setFree({ ...free, format: [x.w, x.h] })} />)}
            <Block><Slider label="Focal length" value={free.focal} min={8} max={300} format={(v) => `${v} mm`} onChange={(v) => setFree({ ...free, focal: v })} /></Block>
            <Block><Seg block options={[{ id: "1", label: "Spherical" }, { id: "1.33", label: "1.33×" }, { id: "1.5", label: "1.5×" }, { id: "2", label: "2×" }]} value={String(free.squeeze)} onChange={(v) => setFree({ ...free, squeeze: Number(v) })} accessibilityLabel="Squeeze" /></Block>
            <Block><Seg block options={[{ id: "", label: "As seen" }, ...DELIVERIES.slice(0, 3).map((d) => ({ id: String(d.ratio), label: d.label }))]} value={free.delivery ? String(free.delivery) : ""} onChange={(v) => setFree({ ...free, delivery: v ? Number(v) : null })} accessibilityLabel="Delivery" /></Block>
            <Block><Button label="Use these values" onPress={() => pick(free)} /></Block>
          </>
        )}
        {tab === "aspect" && DELIVERIES.map((d) => <ListRow key={d.label} icon="frame" title={d.label} selected={current?.kind === "aspect" && Math.abs(current.aspect - d.ratio) < 0.001} trailing={null} onPress={() => pick({ kind: "aspect", aspect: d.ratio })} />)}
      </SheetList>
    </Sheet>
  );
}

/** The folder for new photos: the top level of the project (the default), a folder, or a new one. It stays until changed. */
function FolderSheet({ project, current, folders, onClose }: { project: string; current: string | null; folders: { id: string; name: string }[]; onClose: () => void }) {
  const [name, setName] = useState("");
  const set = (id: string | null) => { nextFolder.set((f) => ({ ...f, [project]: id })); onClose(); };
  const make = async () => {
    if (!canCall()) { toast("A new folder needs a connection", "danger"); return; }
    try { const id = randomUUID(); const f = await putFile(id, { type: "folder", project_id: project, name: name.trim() || "Photos" }); await loadLibrary(); set(f.id); }
    catch (e) { toast(`No folder: ${(e as Error).message}`, "danger"); }
  };
  return (
    <Sheet visible title="New photos go to" onClose={onClose}>
      <SheetList>
        <ListRow icon="folder" title="The top level of the project" selected={!current} trailing={null} onPress={() => set(null)} />
        {folders.map((f) => <ListRow key={f.id} icon="folder" title={f.name} selected={current === f.id} trailing={null} onPress={() => set(f.id)} />)}
        <Block><SectionLabel>A new folder</SectionLabel><NameInput value={name} onChange={setName} placeholder="Name" /><Button kind="secondary" icon="plus" label="Make it and use it" onPress={() => void make()} /></Block>
      </SheetList>
    </Sheet>
  );
}

function LayoutSheet({ current, onClose }: { current: string; onClose: () => void }) {
  return (
    <Sheet visible title="Camera layout" sub="Made in the Studio (Camera layouts)" onClose={onClose}>
      <SheetList>
        {allLayouts().map((l) => <ListRow key={l.id} icon={l.builtin ? "lock" : "camera-layout"} title={l.name} meta={l.builtin ? "Built in" : undefined} selected={current === l.id} trailing={null} onPress={() => { chooseLayout(l.id); onClose(); }} />)}
      </SheetList>
    </Sheet>
  );
}

function NameSheet({ title, initial, onClose, onDone }: { title: string; initial: string; onClose: () => void; onDone: (name: string) => void }) {
  const [name, setName] = useState(initial);
  return (
    <Sheet visible title={title} onClose={onClose} doneLabel="OK" onDone={() => onDone(name.trim())}>
      <Block><NameInput value={name} onChange={setName} placeholder="Leave empty for the project's pattern" /></Block>
    </Sheet>
  );
}

function NameInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const s = useStyles();
  const { c } = useTheme();
  return <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={c.textDim} maxLength={120} style={[s.input, { color: c.text, borderColor: c.border, backgroundColor: c.surface }]} />;
}

/**
 * A camera control (ux-5-phone.md): black with a white outline and a white icon when off, so it reads over any
 * picture (#426: no see-through fill, no muted outline); filled in the accent colour when on; with text a pill.
 * Its size is this device's choice (Setup › Camera buttons).
 */
function CamButton({ icon, text, label, on, warn, disabled, onPress }: { icon?: IconName; text?: string; label: string; on?: boolean; warn?: boolean; disabled?: boolean; onPress: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const sizes = useCameraButtons();
  const fg = on ? c.onAccent : FIXED.white;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!on, disabled }}
      style={({ pressed }) => [s.cam, { minWidth: sizes.size, height: sizes.size, borderRadius: sizes.size / 2 }, text !== undefined && s.camPill, on && { backgroundColor: c.accent, borderColor: c.accent }, warn && { borderColor: FIXED.record }, pressed && { opacity: 0.7 }, disabled && { opacity: 0.45 }]}>
      {icon && <Icon name={icon} size={sizes.icon} color={warn ? FIXED.record : fg} />}
      {text !== undefined && <Text style={[s.camText, { color: fg }]}>{text}</Text>}
    </Pressable>
  );
}

const useStyles = makeStyles(() => ({
  root: { flex: 1, backgroundColor: FIXED.photoBg },
  mid: { flex: 1, flexDirection: "row", minHeight: 0, minWidth: 0 },
  blank: { flex: 1, justifyContent: "center" },
  view: { flex: 1, overflow: "hidden", backgroundColor: FIXED.photoBg },
  center: { alignItems: "center", justifyContent: "center" },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: FIXED.black },
  barH: { minHeight: 60, paddingHorizontal: 12, paddingVertical: 6 },
  barV: { flexDirection: "column", minWidth: 64, paddingHorizontal: 6, paddingVertical: 12 },
  barOver: { backgroundColor: "transparent", flexWrap: "wrap", gap: 4, minHeight: 0, minWidth: 0 },
  over: { position: "absolute" },
  over_top: { left: 0, right: 0, top: 0 },
  over_bottom: { left: 0, right: 0, bottom: 0 },
  over_left: { left: 0, top: 0, bottom: 0, flexDirection: "row" },
  over_right: { right: 0, top: 0, bottom: 0, flexDirection: "row" },
  tag: { ...type("caption", "bold"), color: FIXED.white, backgroundColor: FIXED.glass, paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.xs, overflow: "hidden", ...num },
  tagWarn: { backgroundColor: FIXED.record },
  strip: { flexDirection: "row", gap: 8, alignItems: "center" },
  stripV: { flexDirection: "column" },
  stepped: { flexDirection: "row", alignItems: "center", gap: 4, padding: 3, borderRadius: 28, borderWidth: 2, borderColor: FIXED.white, backgroundColor: FIXED.black },
  steppedValue: { ...type("label", "bold"), color: FIXED.white, minWidth: 44, textAlign: "center", ...num },
  ctl: { alignItems: "center", gap: 2 },
  ctlLabel: { ...type("caption", "bold"), fontSize: 10, color: FIXED.white, opacity: 0.85 },
  thumb: { width: SIZE.touchMin, height: SIZE.touchMin, borderRadius: RADIUS.sm, overflow: "hidden", borderWidth: 2, borderColor: FIXED.white, backgroundColor: FIXED.black },
  shutter: { width: SIZE.shutter, height: SIZE.shutter, borderRadius: SIZE.shutter / 2, borderWidth: 4, borderColor: FIXED.white, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: SIZE.shutter - 16, height: SIZE.shutter - 16, borderRadius: (SIZE.shutter - 16) / 2, backgroundColor: FIXED.white },
  cam: { minWidth: SIZE.touchMin, height: SIZE.touchMin, borderRadius: SIZE.touchMin / 2, borderWidth: 2, borderColor: FIXED.white, backgroundColor: FIXED.black, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 },
  camPill: { paddingHorizontal: 14 },
  camText: { ...type("label", "bold"), ...num },
  previewChip: { position: "absolute", left: 12, right: 12, top: "45%", flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", backgroundColor: FIXED.white, borderRadius: 20, paddingVertical: 8 },
  previewText: { ...type("label", "bold"), color: FIXED.black },
  input: { ...type("body"), minHeight: 48, borderWidth: 2, borderRadius: RADIUS.sm, paddingHorizontal: 14, marginVertical: 8 },
}));

registerApp({ id: "camera", label: "Camera", icon: "camera", needsProject: true, Screen: Camera });
