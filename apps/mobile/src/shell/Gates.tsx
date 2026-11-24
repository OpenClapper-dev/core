import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { ApiError, signIn } from "../api";
import { createProject, activeProject, projects as projectStore } from "../projects";
import { ActionBar, Banner, Button, Header, Hint, Input, ListRow, makeStyles, Mark, PasswordInput, SectionLabel, Sheet, type } from "../ui";
import { useBack } from "./back";

/** On launch without a session, and whenever a request finds it gone. Buttons at the thumb. */
export function SignInGate({ onSignIn, onSkip }: { onSignIn: () => void; onSkip: () => void }) {
  const s = useStyles();
  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.body}>
        <View style={s.brandRow}><Mark size={32} /><Text style={s.brand}>OpenClapper</Text></View>
        <Text style={s.title}>Sign in</Text>
        <Text style={s.text}>Sign in to send your photos to your projects, with the same account as in the Studio. You stay signed in while you use the app.</Text>
      </ScrollView>
      <ActionBar style={{ flexDirection: "column" }}>
        <Button icon="login" label="Sign in" onPress={onSignIn} />
        <Button kind="secondary" label="Continue without an account" onPress={onSkip} />
        <Hint>Without an account, photos stay on this device.</Hint>
      </ActionBar>
    </View>
  );
}

/** What a failed sign-in tells the person: ours for a wrong password or no network, the server's for the rest (blocked). */
function problem(e: unknown): string {
  if (e instanceof ApiError) return e.status === 401 ? "Wrong email or password." : e.message;
  return "Couldn't reach the server. Check the connection; photos you take meanwhile stay on this device.";
}

/** Email and password, the same account as the Studio. The button sits under the fields, so the keyboard never covers it. */
export function LoginForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const s = useStyles();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBack(onCancel);
  const ready = !!email.trim() && !!password && !busy;
  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try { await signIn(email.trim(), password); onDone(); } catch (e) { setError(problem(e)); setBusy(false); }
  };
  return (
    <View style={s.root}>
      <Header title="Sign in" onBack={onCancel} offline={false} />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
        <SectionLabel>Email</SectionLabel>
        <Input value={email} onChangeText={setEmail} editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="username" returnKeyType="next" />
        <SectionLabel>Password</SectionLabel>
        <PasswordInput value={password} onChangeText={setPassword} editable={!busy} autoComplete="password" textContentType="password" returnKeyType="go" onSubmitEditing={() => void submit()} />
        {error && <Banner kind="danger" title={error} />}
        <Button icon="login" label={busy ? "Signing in…" : "Sign in"} busy={busy} disabled={!ready} onPress={() => void submit()} />
        <Hint>There is no sign-up: an administrator makes accounts.</Hint>
      </ScrollView>
    </View>
  );
}

/** The projects to choose from, and a new one (works offline and without an account). */
export function ProjectList({ onPicked }: { onPicked?: () => void }) {
  const list = projectStore.use();
  const active = activeProject.use();
  const [naming, setNaming] = useState<string | null>(null);
  return (
    <>
      {list.map((p) => <ListRow key={p.id} icon="film" title={p.name} meta={p.synced ? undefined : "Not on the server yet"} selected={p.id === active} trailing={null} onPress={() => { activeProject.set(p.id); onPicked?.(); }} />)}
      <ListRow icon="plus" title="New project" meta="Also works offline" trailing={null} onPress={() => setNaming("")} />
      <Sheet visible={naming !== null} title="New project" onClose={() => setNaming(null)} doneLabel="Create" onDone={() => { if (naming?.trim()) { createProject(naming); setNaming(null); onPicked?.(); } }}>
        <SectionLabel>Name</SectionLabel>
        <Input value={naming ?? ""} onChangeText={setNaming} autoFocus returnKeyType="done" onSubmitEditing={() => { if (naming?.trim()) { createProject(naming); setNaming(null); onPicked?.(); } }} />
        <Hint>Made on the server at the next sync. If a project of that name exists there, its photos go into that one.</Hint>
      </Sheet>
    </>
  );
}

/** Shown in place of an app that works inside a project while none is chosen. Setup stays reachable. */
export function ProjectGate({ app }: { app: string }) {
  const s = useStyles();
  return (
    <View style={s.root}>
      <Header title={app} />
      <ScrollView>
        <View style={s.body}>
          <Text style={s.title}>Choose a project</Text>
          <Text style={s.text}>{app} works inside a project.</Text>
        </View>
        <ProjectList />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.bg },
  body: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16, gap: 10 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  brand: { ...type("title", "heavy"), color: c.text },
  title: { ...type("heading", "heavy"), color: c.text },
  text: { ...type("body"), color: c.textDim },
}));
