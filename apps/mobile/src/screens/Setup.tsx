import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useApp } from "../appState";
import { isSignedIn, onAuthChange, signedInEmail } from "../auth";
import { API_URL, isConfigured } from "../config";
import { isLogging, logCount } from "../log";
import { offlineProject } from "../offline";
import { useRigs } from "../rigs";
import { useSync } from "../sync";
import { AppHeader, Banner, Button, ListRow, makeStyles, num, SectionLabel, Seg, SyncCard, type } from "../ui";
import { colourName } from "./SetupScreens";
import type { ViewSettings } from "../types";

export const THEME_OPTIONS = [
  { id: "auto", icon: "theme-light-dark", label: "Auto" },
  { id: "sun", icon: "white-balance-sunny", label: "Sun" },
  { id: "set", icon: "weather-night", label: "Set" },
] as const;

const chipCount = (s: ViewSettings) => Object.values(s.hudChips).filter(Boolean).length;

/**
 * The Setup tab as a hub: the top answers "is everything safe on the server?", then the theme
 * (the only theme control), then one row per group showing its current value. Each row opens
 * its own short screen; settings save on change.
 */
export function Setup() {
  const s = useStyles();
  const app = useApp();
  const { settings: st } = app;
  const sync = useSync();
  const { rigs, active } = useRigs();
  const [email, setEmail] = useState(() => (isSignedIn() ? signedInEmail() : null));
  useEffect(() => onAuthChange(() => setEmail(isSignedIn() ? signedInEmail() : null)), []);
  const signedIn = !!email;

  return (
    <View style={s.root}>
      <AppHeader />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={s.top}>
          {signedIn || !isConfigured
            ? <SyncCard sync={sync} onPress={() => app.push({ name: "uploads" })} />
            : (
              <View style={{ gap: 8 }}>
                <Banner kind="warn" icon="account-alert-outline" title="Not signed in" meta={sync.pending ? `${sync.pending} shot(s) wait on this phone until you sign in.` : "Shots stay on this phone until you sign in."} />
                <Button icon="login" label="Sign in with email PIN" onPress={app.signIn} />
              </View>
            )}
          <SectionLabel>Theme</SectionLabel>
          <Seg size="lg" block accessibilityLabel="Theme" value={st.theme} onChange={(v) => app.setSettings((x) => ({ ...x, theme: v }))} options={THEME_OPTIONS} />
        </View>
        <View style={s.list}>
          {!signedIn && isConfigured && <ListRow icon="cloud-upload-outline" title="Uploads" meta={sync.pending ? `${sync.pending} on the phone` : "Nothing waiting"} onPress={() => app.push({ name: "uploads" })} />}
          <ListRow icon="folder-outline" title="Project" meta={app.project?.name ?? "None picked"} onPress={app.openProjectSheet} />
          <ListRow icon="camera-control" title="Rigs & lenses" meta={rigs.length ? `${rigs.length} rig${rigs.length === 1 ? "" : "s"} · using ${active?.name ?? "none"}` : "No rig yet"} onPress={() => app.push({ name: "rigs" })} />
          <ListRow icon="crop-free" title="Viewfinder" meta={`Frame ${colourName(st.borderColor).toLowerCase()} ${st.borderWidthPx} px · blackout ${st.blackoutEnabled ? "on" : "off"} · ${chipCount(st)} HUD chips`} onPress={() => app.push({ name: "viewfinderSettings" })} />
          <ListRow icon="camera-outline" title="Capture" meta={`GPS ${st.gpsMode} · direct upload ${st.directUpload ? "on" : "off"} · rig ${st.rigOrientation}`} onPress={() => app.push({ name: "captureSettings" })} />
          <ListRow icon="cloud-off-outline" title="Offline" meta={[st.offlineMode ? "Offline mode on" : "Offline mode off", offlineProject(app.project?.id ?? null) ? "project on the phone" : null].filter(Boolean).join(" · ")} onPress={() => app.push({ name: "offline" })} />
          <ListRow icon="tune-variant" title="Phone calibration" meta={`${st.phoneEquivalentFocalMm} mm-eq · ${st.phoneCalibration === "auto" ? "from the photos" : "manual"}`} onPress={() => app.push({ name: "calibration" })} />
          <ListRow icon="account-outline" title="Account" meta={email ?? (isConfigured ? "Not signed in" : "This build has no server")} onPress={() => app.push({ name: "account" })} />
          <ListRow icon="bug-outline" title="Debug log" meta={isLogging() ? `Recording · ${logCount()} entries` : `Off · ${logCount()} entries`} onPress={() => app.push({ name: "debugLog" })} />
        </View>
        <Text style={s.footer}>API: {isConfigured ? API_URL.replace(/^https?:\/\//, "") : "not configured"}</Text>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  top: { padding: 16, gap: 12 },
  list: { borderTopWidth: 1, borderTopColor: c.borderSubtle },
  footer: { ...type("caption"), color: c.textDim, paddingHorizontal: 16, paddingTop: 16, ...num },
}));
