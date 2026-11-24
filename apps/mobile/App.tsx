import { useEffect, useMemo, useState } from "react";
import { BackHandler, Pressable, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
// One module per weight, so only the weights in use are bundled.
import { AtkinsonHyperlegibleNext_400Regular } from "@expo-google-fonts/atkinson-hyperlegible-next/400Regular";
import { AtkinsonHyperlegibleNext_500Medium } from "@expo-google-fonts/atkinson-hyperlegible-next/500Medium";
import { AtkinsonHyperlegibleNext_600SemiBold } from "@expo-google-fonts/atkinson-hyperlegible-next/600SemiBold";
import { AtkinsonHyperlegibleNext_700Bold } from "@expo-google-fonts/atkinson-hyperlegible-next/700Bold";
import { AtkinsonHyperlegibleNext_800ExtraBold } from "@expo-google-fonts/atkinson-hyperlegible-next/800ExtraBold";
import "./src/apps";
import { appOf, type PhoneApp } from "./src/apps/registry";
import { device } from "./src/device";
import { usePrefs } from "./src/prefs";
import { useProject } from "./src/projects";
import { apply as applySettings } from "./src/settings";
import { handleBack } from "./src/shell/back";
import { LoginForm, ProjectGate, SignInGate } from "./src/shell/Gates";
import { initialLogin, login as loginState, skipped } from "./src/shell/signin";
import { setTabOpener } from "./src/shell/nav";
import { startSync } from "./src/sync";
import { startLink } from "./src/link";
import { ConfirmHost, Icon, makeStyles, PALETTES, resolveTheme, SIZE, ThemeProvider, ToastHost, type, useTheme } from "./src/ui";

// Offline mode and logging take effect before the first request; the sign-in gate is decided once.
applySettings();
initialLogin();

export default function Root() {
  // The UI font; render nothing for the few frames it takes to load (and carry on with the system font if it fails).
  const [fontsLoaded, fontError] = useFonts({
    AtkinsonHyperlegibleNext_400Regular, AtkinsonHyperlegibleNext_500Medium, AtkinsonHyperlegibleNext_600SemiBold,
    AtkinsonHyperlegibleNext_700Bold, AtkinsonHyperlegibleNext_800ExtraBold,
  });
  const prefs = usePrefs();
  if (!fontsLoaded && !fontError) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider choice={prefs.theme}>
        <App />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** The tabs this device shows: its choice, without apps this build does not have, and Setup always last. */
function useTabs(): PhoneApp[] {
  const dev = device.use();
  const key = dev.tabs.join(",");
  return useMemo(() => [...dev.tabs.filter((t) => t !== "setup").map(appOf).filter((a): a is PhoneApp => !!a), appOf("setup")!], [key]);
}

function App() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const portrait = height >= width;
  const tabs = useTabs();
  const [tab, setTab] = useState(() => tabs[0].id);
  // Apps stay mounted once opened, so their state survives a switch of tabs.
  const [opened, setOpened] = useState<string[]>([tab]);
  const login = loginState.use();
  const project = useProject();
  const os = useColorScheme();
  const prefs = usePrefs();
  const themeName = resolveTheme(prefs.theme, os);

  useEffect(() => { startSync(); startLink(); }, []);
  // The tab in front was taken off this device: the first tab instead.
  const current = tabs.find((t) => t.id === tab) ?? tabs[0];
  const go = (id: string) => { setTab(id); setOpened((o) => (o.includes(id) ? o : [...o, id])); };
  useEffect(() => { setTabOpener((id) => { if (!tabs.some((t) => t.id === id)) return false; go(id); return true; }); return () => setTabOpener(null); }, [tabs]);

  // Android back: a screen that can go back takes it; then the first tab; then out of the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (login === "form") { loginState.set("gate"); return true; }
      if (login === "formFromApp") { loginState.set(null); return true; }
      if (login) return false;
      if (handleBack()) return true;
      if (current.id !== tabs[0].id) { go(tabs[0].id); return true; }
      return false;
    });
    return () => sub.remove();
  }, [login, current.id, tabs]);

  const bg = PALETTES[themeName];
  if (login === "gate" || login === "form" || login === "formFromApp") {
    return (
      <View style={{ flex: 1, backgroundColor: bg.bg, paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }}>
        <StatusBar style={themeName === "dark" ? "light" : "dark"} />
        {login === "gate"
          ? <SignInGate onSignIn={() => loginState.set("form")} onSkip={() => { skipped.set(true); loginState.set(null); }} />
          : <LoginForm onDone={() => loginState.set(null)} onCancel={() => loginState.set(login === "form" ? "gate" : null)} />}
        <ToastHost bottom={SIZE.edgePad + 64} />
        <ConfirmHost />
      </View>
    );
  }

  const bar = portrait ? Math.max(insets.bottom, 8) : Math.max(insets.right, 8);
  return (
    <View style={{ flex: 1, flexDirection: portrait ? "column" : "row", backgroundColor: bg.surface }}>
      <StatusBar style={themeName === "dark" ? "light" : "dark"} />
      <View style={{ flex: 1, backgroundColor: bg.bg, paddingTop: portrait ? insets.top : 0, paddingLeft: portrait ? 0 : insets.left }}>
        {tabs.filter((t) => opened.includes(t.id) || t.id === current.id).map((t) => (
          <View key={t.id} style={[{ flex: 1 }, t.id !== current.id && { display: "none" }]}>
            {t.needsProject && !project ? <ProjectGate app={t.label} /> : <t.Screen active={t.id === current.id} />}
          </View>
        ))}
      </View>
      <TabBar tabs={tabs} value={current.id} onChange={go} side={!portrait} pad={bar} />
      <ToastHost bottom={portrait ? SIZE.tabBar + bar : 16} />
      <ConfirmHost />
    </View>
  );
}

/**
 * One tab bar for every app (docs/rewrite/ux-5-phone.md): under the screen held upright, at its right
 * edge held in landscape. The tab in front has its glyph on an accent pill.
 */
function TabBar({ tabs, value, onChange, side, pad }: { tabs: PhoneApp[]; value: string; onChange: (id: string) => void; side: boolean; pad: number }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <View accessibilityRole="tablist" style={[s.bar, side ? { width: 80 + pad, paddingRight: pad, flexDirection: "column", borderLeftWidth: 1 } : { height: SIZE.tabBar + pad, paddingBottom: pad, flexDirection: "row", borderTopWidth: 1 }]}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <Pressable key={t.id} onPress={() => onChange(t.id)} style={s.tab} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label}>
            <View style={[s.pill, on && { backgroundColor: c.accent }]}><Icon name={t.icon} size={22} color={on ? c.onAccent : c.text} /></View>
            <Text style={[s.label, on && s.labelOn]} numberOfLines={1}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  bar: { backgroundColor: c.surface, borderColor: c.borderSubtle, justifyContent: "space-around", alignItems: "stretch", paddingHorizontal: 4, paddingTop: 4 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 3, minWidth: 52, minHeight: 56, maxHeight: 88 },
  pill: { width: 56, height: 32, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  label: { ...type("caption", "medium"), fontSize: 12, lineHeight: 14, color: c.text },
  labelOn: { fontFamily: type("caption", "heavy").fontFamily },
}));
