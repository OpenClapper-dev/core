import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { ApiError, signIn } from "../api";
import { ActionBar, Banner, BORDER, Button, Hint, IconButton, Input, ListRow, makeStyles, Mark, SectionLabel, SIZE, type } from "../ui";
import { NewProjectSheet, projectMeta, type PickProject } from "../components/ProjectSheet";
import type { ProjectEntry } from "../types";

/** Full-screen gate on launch without a session and whenever a request finds it gone. Buttons at the thumb. */
export function SignInGate({ onSignIn, onSkip }: { onSignIn: () => void; onSkip: () => void }) {
  const s = useStyles();
  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.gateBody}>
        <View style={s.brandRow}><Mark size={32} /><Text style={s.brand}>Fielder</Text></View>
        <Text style={s.gateTitle}>Sign in</Text>
        <Text style={s.gateText}>With your Fielder account, the same as on the dashboard. You stay signed in while you use the app.</Text>
      </ScrollView>
      <ActionBar edge style={{ flexDirection: "column" }}>
        <Button icon="login" label="Sign in" onPress={onSignIn} />
        <Button kind="secondary" label="Continue without signing in" onPress={onSkip} />
        <Hint>Without signing in, shots stay on the phone.</Hint>
      </ActionBar>
    </View>
  );
}

/** What a failed sign-in tells the user: ours for a wrong password or no network, the server's for the rest (locked, blocked). */
function problem(e: unknown): string {
  if (e instanceof ApiError) return e.status === 401 ? "Wrong email or password." : e.message;
  return "Couldn't reach the server. Check the connection; shots you take meanwhile stay on the phone.";
}

/** Email and password (epic #107), the same account as the dashboard. The button sits under the fields, so the keyboard never covers it. */
export function LoginForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const s = useStyles();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !!email.trim() && !!password && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try { await signIn(email.trim(), password); onDone(); } catch (e) { setError(problem(e)); setBusy(false); }
  };
  return (
    <View style={s.root}>
      <View style={s.webHead}>
        <IconButton plain icon="close" label="Cancel sign-in" onPress={onCancel} />
        <Text style={s.webTitle}>Sign in</Text>
      </View>
      <ScrollView contentContainerStyle={s.gateBody} keyboardShouldPersistTaps="handled">
        <SectionLabel>Email</SectionLabel>
        <Input value={email} onChangeText={setEmail} editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="username" returnKeyType="next" />
        <SectionLabel>Password</SectionLabel>
        <Input value={password} onChangeText={setPassword} editable={!busy} secureTextEntry autoComplete="password" textContentType="password" returnKeyType="go" onSubmitEditing={() => void submit()} />
        {error && <Banner kind="danger" title={error} />}
        <Button icon="login" label={busy ? "Signing in…" : "Sign in"} busy={busy} disabled={!ready} onPress={() => void submit()} />
        <Hint>Same account as the dashboard. There is no sign-up yet: an administrator makes accounts.</Hint>
      </ScrollView>
    </View>
  );
}

/** First launch (or the active project is gone): pick one before anything else. No close, no tab bar. */
export function ProjectGate({ projects, onPick }: { projects: ProjectEntry[]; onPick: PickProject }) {
  const s = useStyles();
  const [creating, setCreating] = useState(false);
  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={s.gateBody}>
          <View style={s.brandRow}><Mark size={32} /><Text style={s.brand}>Fielder</Text></View>
          <Text style={s.gateTitle}>Pick a project</Text>
          <Text style={s.gateText}>Every shot goes into the active project. You can switch at any time from the header.</Text>
        </View>
        {projects.map((p) => <ListRow key={p.id} icon={p.synced ? "folder-outline" : "folder-sync-outline"} title={p.name} meta={projectMeta(p)} onPress={() => onPick(p.id, null)} />)}
        {projects.length === 0 && <View style={{ paddingHorizontal: 16 }}><Hint>No projects yet. Create the first one; it syncs once you are signed in.</Hint></View>}
      </ScrollView>
      <ActionBar edge>
        <Button style={{ flex: 1 }} icon="plus" label="New project" onPress={() => setCreating(true)} />
      </ActionBar>
      <NewProjectSheet visible={creating} projects={projects} onPick={(id, p) => { setCreating(false); onPick(id, p); }} onClose={() => setCreating(false)} />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  gateBody: { paddingHorizontal: 16, paddingTop: 32, paddingBottom: 16, gap: 10 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  brand: { ...type("title", "heavy"), color: c.text },
  gateTitle: { ...type("display", "heavy"), color: c.text },
  gateText: { ...type("body"), color: c.textDim },
  webHead: { height: SIZE.header, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, backgroundColor: c.surface, borderBottomWidth: BORDER.control, borderBottomColor: c.borderSubtle },
  webTitle: { ...type("title", "bold"), color: c.text },
}));
