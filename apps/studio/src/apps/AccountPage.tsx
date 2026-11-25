import { useEffect, useState } from "preact/hooks";
import { Avatar, Badge, Button, Dialog, FormField, PasswordInput, Select, SettingsGroup, Spinner, TextInput } from "@openclapper/design";
import { changePassword, deleteMember, fetchMembers, fetchWorkspaces, putMember, putWorkspace, type Member, type Workspace, type WorkspaceRole } from "../api";
import { confirm, openDialog, prompt, toast, toastError } from "../hosts";
import { saveProject } from "../projects";
import { boot, signOut, useUser } from "../user";

const RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer" };
const ROLE_OPTIONS: { value: Exclude<WorkspaceRole, "owner">; label: string }[] = [
  { value: "viewer", label: "Viewer · looks only" },
  { value: "editor", label: "Editor · changes content" },
  { value: "admin", label: "Admin · also manages members" },
];
type Assignable = Exclude<WorkspaceRole, "owner">;

/**
 * The same rule as the Worker's (workspaces.ts): admins manage editors and viewers, the owner also
 * admins; the owner's own role never changes here.
 */
function canManage(mine: WorkspaceRole, from: WorkspaceRole | null, to: WorkspaceRole | null): boolean {
  if (from === "owner") return false;
  const needs = Math.max(RANK[from ?? "viewer"], RANK[to ?? "viewer"]) >= RANK.admin ? RANK.owner : RANK.admin;
  return RANK[mine] >= needs;
}

/** Change password: the current one, the new one twice. The hidden username lets password managers file the new one. */
function PasswordDialog({ email, close }: { email: string; close: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { document.getElementById("oc-pw-current")?.focus(); }, []);
  const mismatch = again !== "" && again !== next;
  const short = next !== "" && next.length < 10;
  const ready = !!current && next.length >= 10 && next === again && !busy;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    try { await changePassword(current, next); toast("Password changed. Other sessions are signed out."); close(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <Dialog fixed title="Change password" onClose={close} footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={!ready} loading={busy} onClick={() => void save()}>Change password</Button></>}>
      <form className="st-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <input type="text" autoComplete="username" value={email} readOnly hidden />
        <FormField label="Current password" htmlFor="oc-pw-current" error={error ?? undefined}><PasswordInput id="oc-pw-current" autoComplete="current-password" value={current} disabled={busy} invalid={!!error} onInput={(e) => { setCurrent(e.currentTarget.value); setError(null); }} /></FormField>
        <FormField label="New password" htmlFor="oc-pw-new" hint="At least 10 characters." error={short ? "Too short: at least 10 characters." : undefined}><PasswordInput id="oc-pw-new" autoComplete="new-password" value={next} disabled={busy} invalid={short} onInput={(e) => setNext(e.currentTarget.value)} /></FormField>
        <FormField label="New password again" htmlFor="oc-pw-again" error={mismatch ? "Not the same as above." : undefined}><PasswordInput id="oc-pw-again" autoComplete="new-password" value={again} disabled={busy} invalid={mismatch} onInput={(e) => setAgain(e.currentTarget.value)} /></FormField>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function WorkspaceCard({ ws, meId, onChanged }: { ws: Workspace; meId: string; onChanged: () => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Assignable>("editor");
  const [busy, setBusy] = useState(false);
  const reload = () => fetchMembers(ws.id).then(setMembers, toastError);
  useEffect(() => { void reload(); }, [ws.id]);
  const admin = RANK[ws.role] >= RANK.admin;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); await reload(); onChanged(); } catch (e) { toastError(e); } finally { setBusy(false); }
  };
  const add = () => run(async () => { await putMember(ws.id, email.trim(), role); setEmail(""); }, `${email.trim()} is in ${ws.name}`);
  const remove = async (m: Member) => {
    const self = m.user_id === meId;
    const ok = await confirm({ title: self ? `Leave ${ws.name}?` : `Remove ${m.email}?`, message: self ? "Its projects disappear from your Studio until someone invites you again." : `They lose access to every project of ${ws.name}.`, confirmLabel: self ? "Leave" : "Remove", danger: true });
    if (ok) await run(() => deleteMember(ws.id, m.user_id));
  };
  const rename = async () => {
    const name = await prompt({ title: "Rename workspace", label: "Name", value: ws.name, confirmLabel: "Rename" });
    if (name && name !== ws.name) await run(() => putWorkspace(ws.id, name));
  };
  const newProject = async () => {
    const name = await prompt({ title: `New project in ${ws.name}`, label: "Name", confirmLabel: "Create" });
    if (!name) return;
    try { const p = await saveProject(crypto.randomUUID(), name, ws.id); toast(`Created ${p.name} in ${ws.name}`); onChanged(); } catch (e) { toastError(e); }
  };

  return (
    <section className="st-ws">
      <header className="st-ws__head">
        <span><strong>{ws.name}</strong> {ws.personal && <Badge>Personal</Badge>}<br /><span className="st-note">Your role: {ROLE_LABEL[ws.role]} · {ws.project_count} project{ws.project_count === 1 ? "" : "s"} · {ws.member_count} member{ws.member_count === 1 ? "" : "s"}</span></span>
        <span className="st-inline">
          {RANK[ws.role] >= RANK.editor && <Button size="sm" icon="plus" onClick={() => void newProject()}>New project here</Button>}
          {admin && !ws.personal && <Button size="sm" variant="quiet" icon="edit" onClick={() => void rename()}>Rename</Button>}
        </span>
      </header>
      <div className="st-ws__members">
        {!members && <Spinner />}
        {members?.map((m) => (
          <div key={m.user_id} className="st-ws__member">
            <span className="st-ws__who">{m.name ? <><strong>{m.name}</strong> <span className="st-note">{m.email}</span></> : m.email}{m.user_id === meId && <span className="st-note"> (you)</span>}</span>
            {canManage(ws.role, m.role, "viewer") && canManage(ws.role, m.role, m.role)
              ? <Select size="sm" aria-label={`Role of ${m.email}`} value={m.role} style={{ width: 230 }} options={ROLE_OPTIONS.filter((o) => canManage(ws.role, m.role, o.value))} onChange={(v) => void run(() => putMember(ws.id, m.email, v as Assignable))} />
              : <span className="st-note">{ROLE_LABEL[m.role]}</span>}
            {m.role !== "owner" && (m.user_id === meId || canManage(ws.role, m.role, null))
              ? <Button size="sm" variant="quiet" icon={m.user_id === meId ? "logout" : "close"} label={m.user_id === meId ? `Leave ${ws.name}` : `Remove ${m.email}`} disabled={busy} onClick={() => void remove(m)} />
              : <span className="st-ws__gap" />}
          </div>
        ))}
      </div>
      {admin && (
        <form className="st-ws__invite" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void add(); }}>
          <TextInput size="sm" type="email" placeholder="Email of an account on this instance" value={email} disabled={busy} style={{ flex: "1 1 220px" }} onInput={(e) => setEmail(e.currentTarget.value)} />
          <Select size="sm" aria-label="Role for the new member" value={role} style={{ width: 230 }} options={ROLE_OPTIONS.filter((o) => canManage(ws.role, null, o.value))} onChange={(v) => setRole(v as Assignable)} />
          <Button size="sm" type="submit" icon="plus" disabled={busy || !email.trim()}>Add</Button>
        </form>
      )}
    </section>
  );
}

/** Settings › Account: who is signed in and the password; nothing else (#426: workspaces have their own section). */
export function AccountPage() {
  const user = useUser();
  if (user.status !== "signed-in") return null;
  const me = user.me.user;
  return (
    <>
      <SettingsGroup title="Signed in">
        <div className="st-setrow">
          <span className="st-inline"><Avatar name={me.name ?? me.email} /><span><strong>{me.name ?? me.email}</strong><br /><span className="st-note">{me.name ? `${me.email} · ` : ""}Accounts are made by an administrator of this instance.</span></span></span>
          <Button icon="logout" onClick={() => void signOut()}>Sign out</Button>
        </div>
        <div className="st-setrow">
          <span><strong>Password</strong><br /><span className="st-note">Every other browser and phone signed in to your account is signed out.</span></span>
          <Button icon="lock" onClick={() => openDialog((close) => <PasswordDialog email={me.email} close={close} />)}>Change password</Button>
        </div>
      </SettingsGroup>
    </>
  );
}

/** The workspaces one belongs to, read once per Settings window and again after a change. */
export function useWorkspaceList(): { list: Workspace[] | null; error: string | null; reload: () => void } {
  const [list, setList] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => { void fetchWorkspaces().then((w) => { setList(w); setError(null); }, (e: Error) => setError(e.message)); };
  useEffect(reload, []);
  return { list, error, reload };
}

/**
 * Settings › Workspaces (#426): every workspace you belong to, with your role, its members and projects; one opens on
 * its own page. A workspace is shared, so it is a page of Settings, not a file.
 */
export function WorkspacesPage({ list, error, reload, onOpen }: { list: Workspace[] | null; error: string | null; reload: () => void; onOpen: (id: string) => void }) {
  const newWorkspace = async () => {
    const name = await prompt({ title: "New workspace", label: "Name", confirmLabel: "Create" });
    if (!name) return;
    // The list of one's workspaces is part of who is signed in: read that again too.
    try { const id = crypto.randomUUID(); await putWorkspace(id, name); reload(); void boot(); onOpen(id); } catch (e) { toastError(e); }
  };
  return (
    <SettingsGroup title="Your workspaces">
      <div className="st-setrow">
        <span className="st-note">Every project belongs to one workspace; its members see it with their role. Your personal workspace is yours; invite people into a shared one. Viewers look, editors change content, admins also manage members.</span>
        <Button icon="plus" onClick={() => void newWorkspace()}>New workspace</Button>
      </div>
      {error && <p className="st-note">{error}</p>}
      {!list && !error && <Spinner />}
      {list?.map((w) => (
        <button key={w.id} type="button" className="st-setrow st-wsrow" onClick={() => onOpen(w.id)}>
          <span><strong>{w.name}</strong> {w.personal && <Badge>Personal</Badge>}<br /><span className="st-note">Your role: {ROLE_LABEL[w.role]} · {w.member_count} member{w.member_count === 1 ? "" : "s"} · {w.project_count} project{w.project_count === 1 ? "" : "s"}</span></span>
          <span className="st-note">Open ›</span>
        </button>
      ))}
    </SettingsGroup>
  );
}

/** One workspace's page: rename, members and roles, a new project in it. */
export function WorkspacePage({ ws, onChanged }: { ws: Workspace; onChanged: () => void }) {
  const user = useUser();
  if (user.status !== "signed-in") return null;
  return <WorkspaceCard ws={ws} meId={user.me.user.id} onChanged={onChanged} />;
}
