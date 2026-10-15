import { useEffect, useMemo, useState } from "react";
import { ScrollView, Share, Text, View } from "react-native";
import { HUMAN_STEPS } from "../defaults";
import { cover } from "../api";
import { useApp } from "../appState";
import { isSignedIn, onAuthChange, sessionExpiry, setToken, signedInEmail } from "../auth";
import { API_URL, isConfigured } from "../config";
import { computeOverlay, formatDeg } from "../framing";
import { clearLog, logCount, logText, setLogging } from "../log";
import { useRigs } from "../rigs";
import { store } from "../storage";
import type { GpsMode, HudChips, Settings } from "../types";
import { Block, BORDER, Button, ListRow, Chip, ChipCell, ChipGrid, ChipRow, confirm, ErrorText, FIXED, Hint, Input, makeStyles, num, PushScreen, SectionLabel, Seg, toast, Toggle, type } from "../ui";
import { HudChip } from "../components/Hud";
import { Overlay } from "../components/Overlay";
import { ShotFrame } from "../components/ShotFrame";
import { OptionSheet } from "../components/OptionSheet";

/** Frame colours on offer (values stored in settings; they draw over the camera image, not the UI). */
export const BORDER_COLORS: { value: string; label: string }[] = [
  { value: "#FFFFFF", label: "White" }, { value: "#FFB300", label: "Amber" }, { value: "#00E676", label: "Green" },
  { value: "#00B0FF", label: "Blue" }, { value: "#FF3B30", label: "Red" }, { value: "#000000", label: "Black" },
];
export const colourName = (hex: string) => BORDER_COLORS.find((x) => x.value.toUpperCase() === hex.toUpperCase())?.label ?? hex;
export const TINTS: { label: string; value: string }[] = [
  { label: "Neutral 62%", value: "rgba(0, 0, 0, 0.62)" },
  { label: "Black 85%", value: "rgba(0,0,0,0.85)" },
  { label: "Red 50%", value: "rgba(255,0,0,0.5)" },
  { label: "White 50%", value: "rgba(255,255,255,0.5)" },
];
const HUD: { key: keyof HudChips; label: string; meta?: string; icon: string }[] = [
  { key: "project", label: "Project", icon: "folder-outline" },
  { key: "rig", label: "Rig and lens", icon: "camera-outline" },
  { key: "fov", label: "FOV", meta: "Full-frame equivalent and angle of view", icon: "angle-acute" },
  { key: "gps", label: "GPS accuracy", icon: "crosshairs-gps" },
  { key: "warnings", label: "Warnings", meta: "No project, no GPS fix, GPS worse than ±20 m, not signed in, rig wider than the phone", icon: "alert-outline" },
];

function useSet() {
  const app = useApp();
  return <K extends keyof Settings>(k: K, v: Settings[K]) => app.setSettings((x) => ({ ...x, [k]: v }));
}

/**
 * Frame look and HUD chips, with a pinned preview (the latest shot, or a plain grey image) drawn
 * with the current border, blackout, human frame and chips, so every change shows at once.
 */
export function ViewfinderSettings() {
  const s = useStyles();
  const app = useApp();
  const st = app.settings;
  const set = useSet();
  const { active } = useRigs();
  const sample = app.shots.shots?.[0] ?? null;
  const W = 320, H = 240;
  const overlay = useMemo(() => (active ? computeOverlay(st, active, store.loadLensMm(), { width: W, height: H }, false) : null), [st, active]);
  const chip = (k: keyof HudChips, v: boolean) => set("hudChips", { ...st.hudChips, [k]: v });
  const [layoutSheet, setLayoutSheet] = useState(false);

  return (
    <PushScreen title="Viewfinder" sub="Changes show on the preview" scroll={false}>
      <View style={s.previewWrap}>
        <View style={[s.preview, { width: W, height: H }]}>
          {sample && <View style={{ position: "absolute" }}><ShotFrame photo={cover(sample)} width={W} settings={st} mode="off" /></View>}
          {overlay && <Overlay preview={{ width: W, height: H }} rect={overlay.rect} settings={st} exceedsPreview={overlay.exceedsPreview} human={overlay.human} />}
          <View style={s.previewChips} pointerEvents="none">
            {st.hudChips.project && <HudChip icon="folder-outline">{app.project?.name ?? "Project"}</HudChip>}
            {st.hudChips.rig && active && <HudChip icon="camera-outline">{active.name}</HudChip>}
            {st.hudChips.fov && overlay && <HudChip icon="angle-acute">FOV {formatDeg(overlay.framing.fov.horizontal)} × {formatDeg(overlay.framing.fov.vertical)}</HudChip>}
            {st.hudChips.gps && <HudChip icon="crosshairs-gps">GPS ±5 m</HudChip>}
            {st.hudChips.warnings && !app.project && <HudChip icon="folder-alert-outline" kind="danger">No project</HudChip>}
          </View>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <ListRow icon="view-dashboard-edit-outline" title="Layout" meta={app.layouts.find((l) => l.id === st.viewfinderLayoutId)?.name ?? "Default"} onPress={() => setLayoutSheet(true)} />
          <Block><Hint>Where the buttons go: layouts are made on the dashboard (Library › Viewfinder) and arrive with the next sync.</Hint></Block>
          <Block><SectionLabel>HUD chips · show on the camera image</SectionLabel></Block>
          {HUD.map((h) => <Toggle key={h.key} icon={h.icon} label={h.label} meta={h.meta} value={st.hudChips[h.key]} onChange={(v) => chip(h.key, v)} />)}
          <Toggle icon="fit-to-screen-outline" label="Fit to frame" meta="Digital zoom so the rig frame fills the screen; also the Fit button" value={st.fitToFrame} onChange={(v) => set("fitToFrame", v)} />
          <Block>
            <SectionLabel>Frame colour</SectionLabel>
            <ChipRow>{BORDER_COLORS.map((x) => <Chip key={x.value} swatch={x.value} label={x.label} selected={x.value.toUpperCase() === st.borderColor.toUpperCase()} onPress={() => set("borderColor", x.value)} />)}</ChipRow>
            <SectionLabel>Frame width</SectionLabel>
            <Seg size="lg" block accessibilityLabel="Frame width" value={String(st.borderWidthPx)} onChange={(v) => set("borderWidthPx", Number(v))} options={[1, 2, 3, 4, 6].map((w) => ({ id: String(w), label: `${w}` }))} />
          </Block>
          <Toggle icon="square-opacity" label="Blackout outside the frame" value={st.blackoutEnabled} onChange={(v) => set("blackoutEnabled", v)} />
          <Block>
            <ChipGrid>
              {TINTS.map((t) => <ChipCell key={t.value}><Chip block swatch={t.value} label={t.label} selected={t.value === st.blackoutColor} disabled={!st.blackoutEnabled} onPress={() => set("blackoutColor", t.value)} /></ChipCell>)}
            </ChipGrid>
            <SectionLabel>Human view button</SectionLabel>
            <Seg size="lg" block accessibilityLabel="Human view button" value={st.humanViewButton} onChange={(v) => set("humanViewButton", v)} options={[{ id: "cycle", label: "Cycle" }, { id: "toggle", label: "Toggle" }]} />
            <ChipRow>{HUMAN_STEPS.map((mm) => <Chip key={mm} label={`${mm} mm-eq`} selected={st.humanViewFocalMm === mm} onPress={() => set("humanViewFocalMm", mm)} />)}</ChipRow>
            <Hint>Cycle: off → 35 → 43 → 50 → off. Toggle: off ↔ {st.humanViewFocalMm} mm-eq. The cyan frame shows roughly what a person sees: 43–50 mm is the region of attention, 35 mm a wider take.</Hint>
          </Block>
        </ScrollView>
      </View>
      <OptionSheet visible={layoutSheet} title="Viewfinder layout" options={[{ id: "__default__", label: "Default" }, ...app.layouts.map((l) => ({ id: l.id, label: l.name }))]}
        value={[st.viewfinderLayoutId ?? "__default__"]} onChange={(ids) => { set("viewfinderLayoutId", ids[0] && ids[0] !== "__default__" ? ids[0] : null); setLayoutSheet(false); }} onClose={() => setLayoutSheet(false)} />
    </PushScreen>
  );
}

const GPS_HINTS: Record<GpsMode, string> = {
  high: "A fresh, precise fix for every capture. With a poor signal the shutter can wait up to 8 s for it.",
  low: "Takes whatever position the phone has right now, however rough; the shutter never waits. Uses less battery.",
  off: "No location at all: the GPS is not used and photos carry no position. Set one later by hand if needed.",
};

export function CaptureSettings() {
  const st = useApp().settings;
  const set = useSet();
  return (
    <PushScreen title="Capture">
      <Toggle icon="cloud-upload-outline" label="Direct upload" meta="Skip the Tag screen: shots queue untagged; tag them later in History or the dashboard." value={st.directUpload} onChange={(v) => set("directUpload", v)} />
      <Block>
        <SectionLabel>GPS</SectionLabel>
        <Seg size="lg" block accessibilityLabel="GPS mode" value={st.gpsMode} onChange={(v) => set("gpsMode", v)} options={[{ id: "high", icon: "crosshairs-gps", label: "High" }, { id: "low", icon: "crosshairs", label: "Low" }, { id: "off", icon: "crosshairs-off", label: "Off" }]} />
        <Hint>{GPS_HINTS[st.gpsMode]} In a sequence every photo after the first takes the first one's position, in every mode.</Hint>
      </Block>
      <Block>
        <SectionLabel>Rig orientation</SectionLabel>
        <Seg size="lg" block accessibilityLabel="Rig orientation" value={st.rigOrientation} onChange={(v) => set("rigOrientation", v)} options={[{ id: "landscape", icon: "crop-landscape", label: "Landscape" }, { id: "portrait", icon: "crop-portrait", label: "Portrait" }]} />
        <Hint>How the cinema camera is held; portrait swaps the frame's axes.</Hint>
        <SectionLabel>Screen on launch</SectionLabel>
        <Seg size="lg" block accessibilityLabel="Screen orientation" value={st.orientationLock} onChange={(v) => set("orientationLock", v)} options={[{ id: "auto", label: "Auto" }, { id: "landscape", label: "Landscape" }, { id: "portrait", label: "Portrait" }]} />
        <Hint>Locks the whole app to that orientation, so it opens ready to shoot. Applies immediately.</Hint>
      </Block>
    </PushScreen>
  );
}

export function Calibration() {
  const st = useApp().settings;
  const set = useSet();
  const [text, setText] = useState(String(st.phoneEquivalentFocalMm));
  const v = Number(text.replace(",", "."));
  const valid = Number.isFinite(v) && v >= 5 && v <= 200;
  const auto = st.phoneCalibration === "auto";
  return (
    <PushScreen title="Phone calibration" sub={st.phoneModel ?? "Calibrates with the first photo"}>
      <Block>
        <SectionLabel>Main camera, 35 mm-equivalent</SectionLabel>
        <Seg block accessibilityLabel="Calibration" value={st.phoneCalibration} onChange={(v) => { set("phoneCalibration", v); setText(String(st.phoneEquivalentFocalMm)); }}
          options={[{ id: "auto", label: "From the photos" }, { id: "manual", label: "Manual" }]} />
        {auto ? (
          <Hint>{st.phoneModel ? `${st.phoneEquivalentFocalMm} mm, from the last photo of the ${st.phoneModel} (EXIF). Each capture checks it again.` : `${st.phoneEquivalentFocalMm} mm until the first photo: then the phone's own EXIF says how wide it sees.`} Switch to Manual if the frame is measurably off against a real camera.</Hint>
        ) : (
          <>
            <Input value={text} keyboardType="decimal-pad" onChangeText={(t) => { setText(t); const n = Number(t.replace(",", ".")); if (Number.isFinite(n) && n >= 5 && n <= 200) set("phoneEquivalentFocalMm", n); }} />
            {!valid && <ErrorText>Enter a value between 5 and 200 mm.</ErrorText>}
            <Hint>Kept as typed; photos no longer change it. A smaller value makes the frame smaller on screen.</Hint>
          </>
        )}
      </Block>
    </PushScreen>
  );
}

export function Account() {
  const s = useStyles();
  const app = useApp();
  const [email, setEmail] = useState(() => (isSignedIn() ? signedInEmail() : null));
  useEffect(() => onAuthChange(() => setEmail(isSignedIn() ? signedInEmail() : null)), []);
  const until = sessionExpiry();
  return (
    <PushScreen title="Account">
      <Block>
        {!isConfigured ? (
          <Hint>This build has no server configured; shots stay on the phone.</Hint>
        ) : email ? (
          <>
            <SectionLabel>Signed in as</SectionLabel>
            <Text style={s.value}>{email}</Text>
            {until && <Text style={s.meta}>Session until {until.toLocaleDateString([], { day: "numeric", month: "short" })}</Text>}
            <Button kind="secondary" icon="logout" label="Sign out" onPress={() => { setToken(null); toast("Signed out", "neutral"); }} />
            <Hint>Signing out keeps queued shots on the phone. They upload after the next sign-in.</Hint>
          </>
        ) : (
          <>
            <Text style={s.value}>Not signed in</Text>
            <Hint>Same login as the dashboard: a one-time PIN by email. Until then, shots stay on the phone.</Hint>
            <Button icon="login" label="Sign in with email PIN" onPress={app.signIn} />
          </>
        )}
      </Block>
    </PushScreen>
  );
}

export function DebugLog() {
  const app = useApp();
  const st = app.settings;
  const set = useSet();
  const [entries, setEntries] = useState(() => logCount());
  const share = async () => {
    const pending = store.loadPending();
    const text = logText({
      exported: new Date().toISOString(),
      phone: `${st.phoneModel ?? "unknown"} · ${st.phoneEquivalentFocalMm} mm-eq (${st.phoneCalibration})`,
      build: `API: ${isConfigured ? API_URL.replace(/^https?:\/\//, "") : "not configured"}`,
      project: app.project ? `${app.project.name} (${app.project.id})` : "none",
      signedIn: signedInEmail() ?? "no",
      pending: pending.map((p) => ({ shot: p.metadata.id, photos: p.metadata.photos.length, attempts: p.attempts, stuck: !!p.stuck, lastError: p.lastError })),
      settings: st,
    });
    await Share.share({ message: text, title: "Fielder debug log" });
  };
  const clear = async () => {
    const r = await confirm({ title: "Clear the debug log?", body: `Deletes all ${entries} entries. Share it first if you still need it.`, confirmLabel: "Clear", danger: true, icon: "eraser", altLabel: "Share first" });
    if (r === "alt") void share();
    else if (r === true) { clearLog(); setEntries(0); toast("Log cleared", "neutral"); }
  };
  return (
    <PushScreen title="Debug log" sub={`${entries} entries`}
      footer={<>
        <Button style={{ flex: 1 }} kind="danger" icon="eraser" label="Clear" onPress={() => void clear()} disabled={entries === 0} />
        <Button style={{ flex: 1 }} kind="secondary" icon="share-variant" label="Share log" onPress={() => void share()} disabled={entries === 0 && !st.loggingEnabled} />
      </>}>
      <Toggle icon="record-rec" label="Record a detailed log" value={st.loggingEnabled} onChange={(v) => { setLogging(v); set("loggingEnabled", v); setEntries(logCount()); }} />
      <Block>
        <Hint>Turn on, reproduce the problem, then share the log with yourself or a chat with an AI agent. Records API calls, uploads, GPS, captures and errors. No photos, no tokens.</Hint>
      </Block>
    </PushScreen>
  );
}

const useStyles = makeStyles((c) => ({
  previewWrap: { alignItems: "center", paddingVertical: 12, backgroundColor: c.surface, borderBottomWidth: BORDER.control, borderBottomColor: c.border },
  preview: { backgroundColor: FIXED.photoBg, overflow: "hidden" },
  previewChips: { position: "absolute", top: 6, left: 6, right: 6, flexDirection: "row", flexWrap: "wrap", gap: 4 },
  value: { ...type("body", "bold"), color: c.text },
  meta: { ...type("small"), color: c.textDim, ...num },
}));

