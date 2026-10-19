import { useEffect, useMemo, useState } from "react";
import { ScrollView, Share, Text, View } from "react-native";
import { layoutOptions, VF_FRAME_COLORS, VF_FRAME_WIDTHS, VF_HUMAN_STEPS, VF_TINTS, type VfLenses } from "@fielder/vocab";
import { changePassword, cover, signOut } from "../api";
import { useApp } from "../appState";
import { isSignedIn, onAuthChange, signedInEmail } from "../auth";
import { API_URL, isConfigured } from "../config";
import { APP_VERSION } from "../version";
import { computeOverlay, formatDeg } from "../framing";
import { clearLog, logCount, logText, setLogging } from "../log";
import { useRigs } from "../rigs";
import { store } from "../storage";
import { zoomLabel, zoomStops } from "../zoom";
import { registeredName } from "../device";
import type { GpsMode, HudChips, Settings } from "../types";
import { Block, BORDER, Button, ListRow, Chip, ChipCell, ChipGrid, ChipRow, confirm, ErrorText, FIXED, Hint, Input, makeStyles, num, PasswordInput, PushScreen, SectionLabel, Seg, toast, Toggle, type } from "../ui";
import { HudChip } from "../components/Hud";
import { Overlay } from "../components/Overlay";
import { ShotFrame } from "../components/ShotFrame";
import { OptionSheet } from "../components/OptionSheet";

/** Frame colours and tints on offer (shared with the dashboard; they draw over the camera image, not the UI). */
export const colourName = (hex: string) => VF_FRAME_COLORS.find((x) => x.value.toUpperCase() === hex.toUpperCase())?.label ?? hex;
const HUD: { key: keyof HudChips; label: string; meta?: string; icon: string }[] = [
  { key: "project", label: "Project", icon: "folder-outline" },
  { key: "rig", label: "Rig and lens", icon: "camera-outline" },
  { key: "fov", label: "FOV", meta: "Full-frame equivalent and angle of view", icon: "angle-acute" },
  { key: "gps", label: "GPS accuracy", icon: "crosshairs-gps" },
  { key: "warnings", label: "Warnings", meta: "No project, no GPS fix, GPS worse than ±20 m, not signed in, rig wider than the phone", icon: "alert-outline" },
];

/** The Human button's toggle value in this layout. */
const humanMm = (l: Parameters<typeof layoutOptions>[0]) => layoutOptions(l).human.mm;

function useSet() {
  const app = useApp();
  return <K extends keyof Settings>(k: K, v: Settings[K]) => app.setSettings((x) => ({ ...x, [k]: v }));
}

/**
 * The layout in use and its look and control options (issue #68: they belong to the layout, so a
 * change here edits the layout, offline-first, and the dashboard sees it). The built-in Default is
 * read-only: greyed out, with Make a copy. A pinned preview (the latest shot, or a plain grey image)
 * shows the frame, blackout, human frame and chips, so every change shows at once.
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
  const readOnly = !app.layoutEntry;
  const look = (patch: Parameters<typeof app.editLayout>[0]["look"]) => app.editLayout({ look: patch });
  const chip = (k: keyof HudChips, v: boolean) => look({ hud: { ...st.hudChips, [k]: v } });
  const human = (patch: Partial<{ mode: "cycle" | "toggle"; mm: number }>) => app.editLayout({ options: { human: { mode: st.humanViewButton, mm: st.humanViewButton === "toggle" ? st.humanViewFocalMm : humanMm(app.layout), ...patch } } });
  const setLenses = (l: VfLenses) => app.editLayout({ options: { lenses: l } });
  const [layoutSheet, setLayoutSheet] = useState(false);
  const lenses = st.phoneLenses;
  const stops = zoomStops(store.loadZoomRange());

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
          <Block><Hint>Where the buttons go, how the frame looks and how the controls behave. Made on the dashboard (Library › Viewfinder); changes here edit the layout too and sync with the next upload.</Hint></Block>
          {readOnly && (
            <Block>
              <Hint>The Default is built in and can't be changed. Make a copy to change its look or controls here or on the dashboard.</Hint>
              <Button kind="secondary" icon="content-copy" label="Make a copy" onPress={app.copyDefaultLayout} />
            </Block>
          )}
          <View pointerEvents={readOnly ? "none" : "auto"} style={readOnly && { opacity: 0.45 }} accessibilityState={{ disabled: readOnly }}>
          <Block>
            <SectionLabel>Phone lenses</SectionLabel>
            <Seg size="lg" block accessibilityLabel="Phone lenses" value={lenses.mode} onChange={(v) => setLenses(v === "pick" ? { mode: "pick", zooms: stops } : v === "fixed" ? { mode: "fixed", zoom: 1 } : { mode: "all" })}
              options={[{ id: "all", label: "All" }, { id: "pick", label: "Pick" }, { id: "fixed", label: "Fixed" }]} />
            {lenses.mode === "pick" && <ChipRow>{stops.map((z) => <Chip key={z} label={zoomLabel(z)} selected={lenses.zooms.includes(z)} onPress={() => setLenses({ mode: "pick", zooms: lenses.zooms.includes(z) ? lenses.zooms.filter((x) => x !== z) : [...lenses.zooms, z] })} />)}</ChipRow>}
            {lenses.mode === "fixed" && <ChipRow>{stops.map((z) => <Chip key={z} label={zoomLabel(z)} selected={lenses.zoom === z} onPress={() => setLenses({ mode: "fixed", zoom: z })} />)}</ChipRow>}
            <Hint>{stops.length > 1 ? "Which of the phone's lenses Shoot offers (0.5× is the ultra-wide). Fixed uses one and shows no buttons." : "Only 1× is known so far: open Shoot once so the app learns the phone's lenses."}</Hint>
          </Block>
          <Block><SectionLabel>HUD chips · show on the camera image</SectionLabel></Block>
          {HUD.map((h) => <Toggle key={h.key} icon={h.icon} label={h.label} meta={h.meta} value={st.hudChips[h.key]} onChange={(v) => chip(h.key, v)} />)}
          <Block>
            <SectionLabel>Frame colour</SectionLabel>
            <ChipRow>{VF_FRAME_COLORS.map((x) => <Chip key={x.value} swatch={x.value} label={x.label} selected={x.value.toUpperCase() === st.borderColor.toUpperCase()} onPress={() => look({ frameColor: x.value })} />)}</ChipRow>
            <SectionLabel>Frame width</SectionLabel>
            <Seg size="lg" block accessibilityLabel="Frame width" value={String(st.borderWidthPx)} onChange={(v) => look({ frameWidth: Number(v) })} options={VF_FRAME_WIDTHS.map((w) => ({ id: String(w), label: `${w}` }))} />
          </Block>
          <Toggle icon="square-opacity" label="Blackout outside the frame" value={st.blackoutEnabled} onChange={(v) => look({ blackout: v })} />
          <Block>
            <ChipGrid>
              {VF_TINTS.map((t) => <ChipCell key={t.value}><Chip block swatch={t.value} label={t.label} selected={t.value === st.blackoutColor} disabled={!st.blackoutEnabled} onPress={() => look({ blackoutColor: t.value })} /></ChipCell>)}
            </ChipGrid>
            <SectionLabel>Human view button</SectionLabel>
            <Seg size="lg" block accessibilityLabel="Human view button" value={st.humanViewButton} onChange={(v) => human({ mode: v })} options={[{ id: "cycle", label: "Cycle" }, { id: "toggle", label: "Toggle" }]} />
            {st.humanViewButton === "toggle" && <ChipRow>{VF_HUMAN_STEPS.map((mm) => <Chip key={mm} label={`${mm} mm-eq`} selected={humanMm(app.layout) === mm} onPress={() => human({ mm })} />)}</ChipRow>}
            <Hint>Cycle: off → 35 → 43 → 50 → off. Toggle: off ↔ {humanMm(app.layout)} mm-eq. The cyan frame shows roughly what a person sees: 43–50 mm is the region of attention, 35 mm a wider take.</Hint>
          </Block>
          </View>
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
        <Hint>{registeredName() ? `On the dashboard as “${registeredName()}” (device specs); each sync updates it.` : "Not on the dashboard yet: Library › Viewfinder › Add device specs reads this phone out."}</Hint>
      </Block>
    </PushScreen>
  );
}

export function Account() {
  const s = useStyles();
  const app = useApp();
  const [email, setEmail] = useState(() => (isSignedIn() ? signedInEmail() : null));
  useEffect(() => onAuthChange(() => setEmail(isSignedIn() ? signedInEmail() : null)), []);
  return (
    <PushScreen title="Account">
      <Block>
        {!isConfigured ? (
          <Hint>This build has no server configured; shots stay on the phone.</Hint>
        ) : email ? (
          <>
            <SectionLabel>Signed in as</SectionLabel>
            <Text style={s.value}>{email}</Text>
            <Text style={s.meta}>The session renews while you use the app.</Text>
            <Button kind="secondary" icon="form-textbox-password" label="Change password" onPress={() => app.push({ name: "password" })} />
            <Button kind="secondary" icon="logout" label="Sign out" onPress={() => { void signOut(); toast("Signed out", "neutral"); }} />
            <Hint>Signing out keeps queued shots on the phone. They upload after the next sign-in.</Hint>
          </>
        ) : (
          <>
            <Text style={s.value}>Not signed in</Text>
            <Hint>With your Fielder account, the same as on the dashboard. Until then, shots stay on the phone.</Hint>
            <Button icon="login" label="Sign in" onPress={app.signIn} />
          </>
        )}
      </Block>
    </PushScreen>
  );
}

/** Change password (issue #148): the current one, the new one twice. Signs out every other browser and phone of the account. */
export function ChangePassword() {
  const app = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = next !== "" && next.length < 10;
  const mismatch = again !== "" && again !== next;
  const ready = !!current && next.length >= 10 && next === again && !busy;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      await changePassword(current, next);
      toast("Password changed. Other sessions are signed out.");
      app.pop();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <PushScreen title="Change password" footer={<Button style={{ flex: 1 }} icon="check" label="Change password" onPress={() => void save()} busy={busy} disabled={!ready} />}>
      <Block>
        <SectionLabel>Current password</SectionLabel>
        <PasswordInput value={current} onChangeText={setCurrent} editable={!busy} autoComplete="current-password" textContentType="password" />
        <SectionLabel>New password</SectionLabel>
        <PasswordInput value={next} onChangeText={setNext} editable={!busy} autoComplete="new-password" textContentType="newPassword" />
        {short ? <ErrorText>Too short: at least 10 characters.</ErrorText> : <Hint>At least 10 characters.</Hint>}
        <SectionLabel>New password again</SectionLabel>
        <PasswordInput value={again} onChangeText={setAgain} editable={!busy} autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={() => void save()} />
        {mismatch && <ErrorText>Not the same as above.</ErrorText>}
        {error && <ErrorText>{error}</ErrorText>}
        <Hint>Every other phone and browser signed in to your account is signed out; this phone stays signed in.</Hint>
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
      build: `${APP_VERSION} · API: ${isConfigured ? API_URL.replace(/^https?:\/\//, "") : "not configured"}`,
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

