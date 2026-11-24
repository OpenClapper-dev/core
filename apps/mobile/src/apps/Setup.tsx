import { useEffect, useState, type ComponentType, type ReactElement } from "react";
import { Pressable, Share, Text, View } from "react-native";
import { changePassword, signOut } from "../api";
import { isSignedIn, onAuthChange, signedInEmail } from "../auth";
import { API_URL, isConfigured } from "../config";
import { device, lenses, renameDevice, reportedModel, setTabs } from "../device";
import { clearLog, logCount, logText } from "../log";
import { setPrefs, usePrefs, usePrefsPending, type Prefs } from "../prefs";
import { useProject } from "../projects";
import { setSettings, settings } from "../settings";
import { ProjectList } from "../shell/Gates";
import { useBack } from "../shell/back";
import { onOpen } from "../shell/nav";
import { startSignIn } from "../shell/signin";
import { APP_VERSION } from "../version";
import { Block, Button, confirm, ErrorText, FieldRow, Header, Hint, Icon, IconButton, Input, ListRow, makeStyles, num, PasswordInput, Screen, SectionLabel, Seg, Sheet, toast, Toggle, type, useTheme, type IconName } from "../ui";
import { appOf, catalogue, registerApp } from "./registry";

/**
 * Setup (docs/rewrite/09-shells.md): always a tab and never removable, because the tabs are chosen
 * here. Project, account, this device, its tabs, the camera's and the look's preferences, offline,
 * the debug log. Pages of their own open over the hub; back returns to it.
 */
type Page = "project" | "account" | "password" | "device" | "tabs" | "camera" | "look" | "offline" | "log";
/** `useMeta` is a hook: it may subscribe to what the row reports. */
const extraRows: { id: string; icon: IconName; label: string; useMeta: () => string; open: () => void }[] = [];
/** Another module's row in the hub (the upload queue adds Uploads). */
export const addSetupRow = (row: (typeof extraRows)[number]) => { extraRows.push(row); };
/** Opens a page of Setup from elsewhere (the camera's uploads chip). */
let opener: ((p: string) => void) | null = null;
export const openSetup = (page: string) => opener?.(page);
const extraPages = new Map<string, (back: () => void) => ReactElement>();
export const addSetupPage = (id: string, render: (back: () => void) => ReactElement) => { extraPages.set(id, render); };

function Setup({ active }: { active: boolean }) {
  const [page, setPage] = useState<string | null>(null);
  useEffect(() => { opener = setPage; const off = onOpen("setup", setPage); return () => { opener = null; off(); }; }, []);
  const back = () => setPage(page === "password" ? "account" : null);
  useBack(page ? back : null, active);
  switch (page) {
    case "project": return <ProjectPage back={back} />;
    case "account": return <AccountPage back={back} open={setPage} />;
    case "password": return <PasswordPage back={back} />;
    case "device": return <DevicePage back={back} />;
    case "tabs": return <TabsPage back={back} />;
    case "camera": return <CameraPage back={back} />;
    case "look": return <LookPage back={back} />;
    case "offline": return <OfflinePage back={back} />;
    case "log": return <LogPage back={back} />;
    default: { const extra = page ? extraPages.get(page) : undefined; return extra ? extra(back) : <Hub open={setPage} />; }
  }
}

function useEmail() {
  const [email, setEmail] = useState(() => (isSignedIn() ? signedInEmail() : null));
  useEffect(() => onAuthChange(() => setEmail(isSignedIn() ? signedInEmail() : null)), []);
  return email;
}

function Hub({ open }: { open: (p: Page | string) => void }) {
  const s = useStyles();
  const project = useProject();
  const email = useEmail();
  const dev = device.use();
  const prefs = usePrefs();
  const local = settings.use();
  // The rows are fixed once the app is loaded, so these hooks run in the same order every time.
  const extraMetas = extraRows.map((r) => ({ r, meta: r.useMeta() }));
  const tabCount = dev.tabs.filter((t) => appOf(t)).length + (dev.tabs.includes("setup") ? 0 : 1);
  const rows: { id: string; icon: IconName; label: string; meta: string; open?: () => void }[] = [
    { id: "project", icon: "film", label: "Project", meta: project?.name ?? "None chosen" },
    { id: "account", icon: "user", label: "Account", meta: email ?? "Not signed in" },
    { id: "device", icon: "mobile", label: "This device", meta: dev.file?.name ?? reportedModel() },
    { id: "tabs", icon: "apps", label: "Tabs on this device", meta: `${tabCount} tabs` },
    ...extraMetas.map(({ r, meta }) => ({ id: r.id, icon: r.icon, label: r.label, meta, open: r.open })),
    { id: "camera", icon: "camera", label: "Camera", meta: prefs.lensNames === "phone" ? "Lenses by the phone's names" : "Lenses by focal length" },
    { id: "look", icon: "palette", label: "Appearance", meta: prefs.theme === "auto" ? "Theme follows the phone" : prefs.theme === "dark" ? "Dark" : "Light" },
    { id: "offline", icon: "cloud-off", label: "Offline", meta: local.offlineMode ? "Offline mode is on" : local.keepProject ? "Project kept on this device" : "Off" },
    { id: "log", icon: "notes", label: "Debug log", meta: local.logging ? "Recording" : "Off" },
  ];
  return (
    <Screen header={<Header title="Setup" />}>
      {rows.map((r) => <ListRow key={r.id} icon={r.icon} title={r.label} meta={r.meta} onPress={r.open ?? (() => open(r.id))} />)}
      <Block><Text style={s.foot}>OpenClapper {APP_VERSION}{isConfigured ? ` · ${API_URL.replace(/^https?:\/\//, "")}` : " · no server in this build"}</Text></Block>
    </Screen>
  );
}

function ProjectPage({ back }: { back: () => void }) {
  return (
    <Screen header={<Header title="Project" sub="New photos go into the chosen one" onBack={back} />}>
      <ProjectList onPicked={back} />
    </Screen>
  );
}

function AccountPage({ back, open }: { back: () => void; open: (p: Page) => void }) {
  const s = useStyles();
  const email = useEmail();
  return (
    <Screen header={<Header title="Account" onBack={back} />}>
      <Block>
        {!isConfigured ? <Hint>This build has no server configured; photos stay on this device.</Hint> : email ? (
          <>
            <SectionLabel>Signed in as</SectionLabel>
            <Text style={s.value}>{email}</Text>
            <Text style={s.meta}>The session renews while you use the app.</Text>
            <Button kind="secondary" icon="lock" label="Change password" onPress={() => open("password")} />
            <Button kind="secondary" icon="logout" label="Sign out" onPress={() => { void signOut(); toast("Signed out", "neutral"); }} />
            <Hint>Signing out keeps photos that wait in the queue on this device. They upload after the next sign-in.</Hint>
          </>
        ) : (
          <>
            <Text style={s.value}>Not signed in</Text>
            <Hint>With your OpenClapper account, the same as in the Studio. Until then, photos stay on this device.</Hint>
            <Button icon="login" label="Sign in" onPress={startSignIn} />
          </>
        )}
      </Block>
    </Screen>
  );
}

/** The current password, the new one twice. Every other browser and phone of the account is signed out. */
function PasswordPage({ back }: { back: () => void }) {
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
    try { await changePassword(current, next); toast("Password changed. Other sessions are signed out."); back(); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <Screen header={<Header title="Change password" onBack={back} />} footer={<Button style={{ flex: 1 }} icon="check" label="Change password" onPress={() => void save()} busy={busy} disabled={!ready} />}>
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
        <Hint>Every other phone and browser signed in to your account is signed out; this one stays signed in.</Hint>
      </Block>
    </Screen>
  );
}

/** Horizontal angle of view of a full-frame-equivalent focal length (36 mm wide). */
const hAov = (f: number) => Math.round((2 * Math.atan(36 / (2 * f)) * 180) / Math.PI);

function DevicePage({ back }: { back: () => void }) {
  const dev = device.use();
  const set = lenses.use();
  const email = useEmail();
  const [naming, setNaming] = useState<string | null>(null);
  const body = dev.file?.body as { kind?: string; screen?: { portrait: { w: number; h: number } } | null } | undefined;
  return (
    <Screen header={<Header title="This device" sub={dev.file ? "Registered by itself, kept current" : email ? "Registers at the next sync" : "Registers once you are signed in"} onBack={back} />}>
      <FieldRow icon="edit" label="Name" value={dev.file?.name ?? reportedModel()} onPress={dev.file ? () => setNaming(dev.file!.name) : undefined} />
      <FieldRow label="Model" value={reportedModel()} />
      {body?.kind && <FieldRow label="Kind" value={body.kind === "tablet" ? "Tablet" : "Phone"} />}
      {body?.screen && <FieldRow label="Screen" value={`${body.screen.portrait.w} × ${body.screen.portrait.h} dp`} />}
      {email && <FieldRow label="Belongs to" value={email} />}
      <Block><SectionLabel>Real lenses, as the camera reports them</SectionLabel></Block>
      {set.lenses.length ? set.lenses.map((l) => (
        <FieldRow key={l.id} icon="lens" label={l.name + (l.main ? " · main" : "")} value={l.focal35 ? `${l.focal35} mm equivalent · ${hAov(l.focal35)}° wide` : "No focal length reported: no optics frame on this lens"} />
      )) : <Block><Hint>Not read yet: open the camera once.</Hint></Block>}
      <Block><Hint>No digital zoom: every photo is the full picture of one real lens.</Hint></Block>
      <Sheet visible={naming !== null} title="Name of this device" onClose={() => setNaming(null)} doneLabel="Save" onDone={() => { renameDevice(naming ?? ""); setNaming(null); }}>
        <Input value={naming ?? ""} onChangeText={setNaming} autoFocus returnKeyType="done" onSubmitEditing={() => { renameDevice(naming ?? ""); setNaming(null); }} />
      </Sheet>
    </Screen>
  );
}

/** Which apps are tabs on this device, in order. Setup is always there; apps this build lacks stay in the choice, unseen. */
function TabsPage({ back }: { back: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const dev = device.use();
  const shown = dev.tabs.filter((t) => t !== "setup" && appOf(t));
  const all = catalogue();
  // The device's own order, with apps of other builds kept where they were.
  const move = (id: string, d: -1 | 1) => {
    const i = shown.indexOf(id), j = i + d;
    if (j < 0 || j >= shown.length) return;
    const next = [...shown]; [next[i], next[j]] = [next[j], next[i]];
    setTabs([...next, ...dev.tabs.filter((t) => t !== "setup" && !appOf(t))]);
  };
  const toggle = (id: string, on: boolean) => setTabs(on ? [...dev.tabs.filter((t) => t !== "setup"), id] : dev.tabs.filter((t) => t !== id && t !== "setup"));
  return (
    <Screen header={<Header title="Tabs on this device" sub="Kept with the device, not the account" onBack={back} />}>
      {shown.map((id, i) => { const a = appOf(id)!; return (
        <View key={id} style={s.tabRow}>
          <Icon name={a.icon} />
          <Text style={s.tabLabel}>{a.label}</Text>
          <IconButton plain icon="arrow-up" label={`${a.label} earlier`} disabled={i === 0} onPress={() => move(id, -1)} />
          <IconButton plain icon="arrow-down" label={`${a.label} later`} disabled={i === shown.length - 1} onPress={() => move(id, 1)} />
          <Pressable onPress={() => toggle(id, false)} accessibilityRole="switch" accessibilityState={{ checked: true }} accessibilityLabel={`${a.label} is a tab`} style={s.check}><Icon name="check" color={c.onAccent} /></Pressable>
        </View>
      ); })}
      <ListRow icon="settings" title="Setup" meta="Always there: tabs are chosen here" trailing={<Icon name="lock" color={c.textDim} />} />
      <Block><SectionLabel>Not a tab on this device</SectionLabel></Block>
      {all.filter((a) => !shown.includes(a.id)).map((a) => <ListRow key={a.id} icon={a.icon} title={a.label} trailing={<Icon name="plus" />} onPress={() => toggle(a.id, true)} />)}
      <Block><Hint>Any app with a touch form can be a tab, on a phone as on a tablet. The choice can also be made in the Studio, under Devices.</Hint></Block>
    </Screen>
  );
}

function PrefSeg<K extends keyof Prefs>({ k, label, options, hint }: { k: K; label: string; options: { id: Prefs[K] & string; label: string }[]; hint?: string }) {
  const prefs = usePrefs();
  return (
    <Block>
      <SectionLabel>{label}</SectionLabel>
      <Seg block options={options} value={prefs[k] as Prefs[K] & string} onChange={(v) => setPrefs({ [k]: v } as Partial<Prefs>)} accessibilityLabel={label} />
      {hint && <Hint>{hint}</Hint>}
    </Block>
  );
}

function PendingNote() {
  const pending = usePrefsPending();
  const email = useEmail();
  return <Block><Hint>{!email ? "Kept on this device until you sign in; then they follow your account." : pending ? "Changed here; saved to your account at the next sync." : "Saved with your account: the same in the Studio and on your other devices."}</Hint></Block>;
}

function CameraPage({ back }: { back: () => void }) {
  return (
    <Screen header={<Header title="Camera" sub="Your preferences, for every layout" onBack={back} />}>
      <PrefSeg k="lensNames" label="Lens names" options={[{ id: "phone", label: "0.5×, 1×, 5×" }, { id: "focal", label: "13, 24, 120" }]} hint="As the phone calls them, or by the full-frame focal length the camera reports for each lens." />
      <PrefSeg k="askCollectionName" label="A collection's name" options={[{ id: "never", label: "By the pattern" }, { id: "start", label: "Ask at start" }, { id: "end", label: "Ask at end" }]} hint="For the camera's collection mode: a switch that starts a collection and ends it." />
      <PendingNote />
    </Screen>
  );
}

function LookPage({ back }: { back: () => void }) {
  return (
    <Screen header={<Header title="Appearance" onBack={back} />}>
      <PrefSeg k="theme" label="Theme" options={[{ id: "auto", label: "Like the phone" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" }]} />
      <PrefSeg k="collectionMark" label="How a photo shows its collection" options={[{ id: "bar", label: "Bar" }, { id: "barleft", label: "Bar left" }, { id: "dot", label: "Dot" }, { id: "frame", label: "Frame" }]} hint="Seen in Media when collections are spread out. The same preference as in the Studio." />
      <PendingNote />
    </Screen>
  );
}

const offlineExtras: ComponentType[] = [];
/** More switches on the Offline page (keeping the project on the device, with Media). */
export const addOfflineSection = (c: (typeof offlineExtras)[number]) => { offlineExtras.push(c); };

function OfflinePage({ back }: { back: () => void }) {
  const local = settings.use();
  return (
    <Screen header={<Header title="Offline" onBack={back} />}>
      <Toggle icon="cloud-off" label="Offline mode" meta="No requests at all. Photos wait in the queue until it is off." value={local.offlineMode} onChange={(v) => setSettings({ offlineMode: v })} />
      {offlineExtras.map((C, i) => <C key={i} />)}
    </Screen>
  );
}

function LogPage({ back }: { back: () => void }) {
  const local = settings.use();
  const [entries, setEntries] = useState(() => logCount());
  const project = useProject();
  const dev = device.use();
  const share = async () => {
    const text = logText({
      exported: new Date().toISOString(),
      device: `${dev.file?.name ?? "not registered"} · ${reportedModel()}`,
      lenses: lenses.get().lenses.map((l) => `${l.name} ${l.focal35 ?? "?"} mm (${l.camera}${l.zoom !== null ? ` @${l.zoom}` : ""})`).join(", "),
      build: `${APP_VERSION} · API: ${isConfigured ? API_URL.replace(/^https?:\/\//, "") : "not configured"}`,
      project: project ? `${project.name} (${project.id})` : "none",
      signedIn: signedInEmail() ?? "no",
      settings: local,
    });
    await Share.share({ message: text, title: "OpenClapper debug log" });
  };
  const clear = async () => {
    const r = await confirm({ title: "Clear the debug log?", body: `Deletes all ${entries} entries. Share it first if you still need it.`, confirmLabel: "Clear", danger: true, icon: "trash", altLabel: "Share first" });
    if (r === "alt") void share();
    else if (r === true) { clearLog(); setEntries(0); toast("Log cleared", "neutral"); }
  };
  return (
    <Screen header={<Header title="Debug log" sub={`${entries} entries`} onBack={back} />}
      footer={<>
        <Button style={{ flex: 1 }} kind="danger" icon="trash" label="Clear" onPress={() => void clear()} disabled={entries === 0} />
        <Button style={{ flex: 1 }} kind="secondary" icon="share" label="Share log" onPress={() => void share()} disabled={entries === 0 && !local.logging} />
      </>}>
      <Toggle icon="record" label="Record a detailed log" value={local.logging} onChange={(v) => { setSettings({ logging: v }); setEntries(logCount()); }} />
      <Block><Hint>Turn on, reproduce the problem, then share the log with yourself or a chat with an AI agent. Records API calls, uploads, the camera's lenses and errors. No photos, no tokens.</Hint></Block>
    </Screen>
  );
}

const useStyles = makeStyles((c) => ({
  value: { ...type("body", "bold"), color: c.text },
  meta: { ...type("small"), color: c.textDim, ...num },
  foot: { ...type("caption"), color: c.textDim, ...num },
  tabRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 64, paddingLeft: 16, paddingRight: 12, backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.borderSubtle },
  tabLabel: { ...type("body", "semibold"), color: c.text, flex: 1, marginLeft: 6 },
  check: { width: 40, height: 40, borderRadius: 8, backgroundColor: c.accent, alignItems: "center", justifyContent: "center", marginLeft: 4 },
}));

registerApp({ id: "setup", label: "Setup", icon: "settings", needsProject: false, Screen: Setup });
