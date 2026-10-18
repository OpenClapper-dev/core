import { useEffect, useState } from "preact/hooks";
import { deleteMember, fetchMembers, fetchWorkspaces, putMember, putProject, putWorkspace, type Member, type Workspace, type WorkspaceRole } from "./api";
import * as data from "./data";
import { Button, confirmDialog, ErrorLine, Icon, IconButton, Input, Loading, ProjectTag, promptDialog, Select, toast } from "./ui";
import { boot, signOut, useUser } from "./user";

const RANK: Record<WorkspaceRole, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };
const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: "Owner", admin: "Admin", editor: "Editor", viewer: "Viewer" };
const ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer · looks only" },
  { value: "editor", label: "Editor · changes content" },
  { value: "admin", label: "Admin · also manages members" },
];

/**
 * The same rule as the Worker's (workspaces.ts): admins manage editors and viewers, the owner also
 * admins; the owner's own role never changes here.
 */
function canManage(mine: WorkspaceRole, from: WorkspaceRole | null, to: WorkspaceRole | null): boolean {
  if (from === "owner") return false;
  const needs = Math.max(RANK[from ?? "viewer"], RANK[to ?? "viewer"]) >= RANK.admin ? RANK.owner : RANK.admin;
  return RANK[mine] >= needs;
}

/** Settings › Account (epic #107): who is signed in, and the workspaces they are in, with members and roles. */
export function AccountSettings() {
  const user = useUser();
  const [list, setList] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => fetchWorkspaces().then((w) => { setList(w); setError(null); }).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);
  if (user.status !== "signed-in") return null;
  const me = user.me.user;

  const newWorkspace = async () => {
    const name = await promptDialog({ title: "New workspace", body: "A workspace you share: invite people on this Fielder into it and give its projects to them.", input: { label: "Name", placeholder: "e.g. Nachtbus crew" }, confirmLabel: "Create" });
    if (!name) return;
    try { await putWorkspace(crypto.randomUUID(), name); await load(); void boot(); } catch (e) { toast((e as Error).message, "danger"); }
  };

  return (
    <div class="settings">
      <section class="settings__sec">
        <h2><Icon name="account-circle-outline" />Account</h2>
        <div class="settings__row">
          <div><strong>{me.name ?? me.email}</strong><span class="meta">{me.name ? `${me.email} · ` : ""}Signed in on this browser. Accounts are made by an administrator of this Fielder.</span></div>
          <div><Button kind="secondary" icon="logout" onClick={() => void signOut()}>Sign out</Button></div>
        </div>
      </section>
      <section class="settings__sec">
        <h2><Icon name="account-group-outline" />Workspaces</h2>
        <div class="settings__row">
          <div><strong>Who sees what</strong><span class="meta">Every project belongs to one workspace; its members see it with their role. Your personal workspace is yours; invite people into a shared one. Viewers look, editors change content, admins also manage editors and viewers, the owner also admins.</span></div>
          <div><Button kind="secondary" icon="plus" onClick={() => void newWorkspace()}>New workspace</Button></div>
        </div>
        {error && <div class="settings__row"><ErrorLine>{error}</ErrorLine></div>}
        {!list && !error && <div class="settings__row"><Loading /></div>}
        {list?.map((w) => <WorkspaceRow key={w.id} ws={w} meId={me.id} onChanged={() => void load()} />)}
      </section>
    </div>
  );
}

function WorkspaceRow({ ws, meId, onChanged }: { ws: Workspace; meId: string; onChanged: () => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<WorkspaceRole, "owner">>("editor");
  const [busy, setBusy] = useState(false);
  const reload = () => fetchMembers(ws.id).then(setMembers).catch((e: Error) => toast(e.message, "danger"));
  useEffect(() => { void reload(); }, [ws.id]);
  const admin = RANK[ws.role] >= RANK.admin;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok); await reload(); onChanged(); } catch (e) { toast((e as Error).message, "danger"); } finally { setBusy(false); }
  };
  const add = () => run(async () => { await putMember(ws.id, email.trim(), role); setEmail(""); }, `${email.trim()} is in ${ws.name}`);
  const remove = async (m: Member) => {
    const self = m.user_id === meId;
    const ok = await confirmDialog({ title: self ? `Leave ${ws.name}?` : `Remove ${m.email}?`, body: self ? "Its projects disappear from your desktop until someone invites you again." : `They lose access to every project of ${ws.name}.`, confirmLabel: self ? "Leave" : "Remove", danger: true });
    if (ok) await run(() => deleteMember(ws.id, m.user_id));
  };
  const rename = async () => {
    const name = await promptDialog({ title: "Rename workspace", input: { label: "Name", value: ws.name }, confirmLabel: "Rename" });
    if (name) await run(() => putWorkspace(ws.id, name));
  };
  const newProject = async () => {
    const name = await promptDialog({ title: `New project in ${ws.name}`, input: { label: "Name", placeholder: "e.g. Short film ‘Nachtbus’" }, confirmLabel: "Create" });
    if (!name) return;
    try {
      const saved = await putProject({ id: crypto.randomUUID(), name, notes: null, workspace_id: ws.id });
      data.setProjects((cur) => [...(cur ?? []), saved].sort((a, b) => a.name.localeCompare(b.name)));
      toast(`Created ${saved.name} in ${ws.name}`);
      onChanged();
    } catch (e) { toast((e as Error).message, "danger"); }
  };

  return (
    <div class="settings__row settings__ws">
      <div>
        <strong>{ws.name} {ws.personal && <ProjectTag>Personal</ProjectTag>}</strong>
        <span class="meta">Your role: {ROLE_LABEL[ws.role]} · {ws.project_count} project{ws.project_count === 1 ? "" : "s"} · {ws.member_count} member{ws.member_count === 1 ? "" : "s"}</span>
        <div class="settings__members">
          {!members && <Loading />}
          {members?.map((m) => (
            <div key={m.user_id} class="settings__member">
              <span class="settings__memberwho">{m.name ? <><strong>{m.name}</strong> <span class="meta">{m.email}</span></> : m.email}{m.user_id === meId && <span class="meta"> (you)</span>}</span>
              {canManage(ws.role, m.role, "viewer") && canManage(ws.role, m.role, m.role)
                ? <Select label={`Role of ${m.email}`} value={m.role} width="230px"
                    options={ROLE_OPTIONS.filter((o) => canManage(ws.role, m.role, o.value as WorkspaceRole))}
                    onChange={(v) => void run(() => putMember(ws.id, m.email, v as Exclude<WorkspaceRole, "owner">))} />
                : <span class="meta">{ROLE_LABEL[m.role]}</span>}
              {m.role !== "owner" && (m.user_id === meId || canManage(ws.role, m.role, null))
                ? <IconButton icon={m.user_id === meId ? "exit-run" : "account-remove-outline"} label={m.user_id === meId ? `Leave ${ws.name}` : `Remove ${m.email}`} title={m.user_id === meId ? "Leave" : "Remove"} disabled={busy} onClick={() => void remove(m)} />
                : <span />}
            </div>
          ))}
        </div>
        {admin && (
          <form class="settings__invite" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void add(); }}>
            <Input sm type="email" placeholder="Email of an account on this Fielder" value={email} disabled={busy} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} boxStyle={{ flex: "1 1 220px" }} />
            <Select label="Role for the new member" value={role} width="230px" options={ROLE_OPTIONS.filter((o) => canManage(ws.role, null, o.value as WorkspaceRole))} onChange={(v) => setRole(v as Exclude<WorkspaceRole, "owner">)} />
            <Button type="submit" size="sm" icon="account-plus-outline" disabled={busy || !email.trim()}>Add</Button>
          </form>
        )}
      </div>
      <div class="settings__wsact">
        {RANK[ws.role] >= RANK.editor && <Button size="sm" kind="secondary" icon="folder-plus-outline" onClick={() => void newProject()}>New project here</Button>}
        {admin && !ws.personal && <Button size="sm" kind="ghost" icon="pencil-outline" onClick={() => void rename()}>Rename</Button>}
      </div>
    </div>
  );
}
