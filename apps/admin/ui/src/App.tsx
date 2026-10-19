import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Button, ConfirmHost, confirmDialog, Empty, ErrorLine, Field, Icon, IconButton, Input, Loading, Mark, Modal, ProjectTag, THEME_CYCLE, THEME_ICON, THEME_LABEL, toast, ToastHost, useTheme } from "@fielder/ui";
import { createUser, deleteUser, fetchOverview, fetchUsers, fetchWorkspaces, patchUser, resetPassword, whoami, type AdminUser, type AdminWorkspace, type Overview } from "./api";

const bytes = (n: number) => (n < 1024 ** 2 ? `${Math.round(n / 1024)} KB` : n < 1024 ** 3 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${(n / 1024 ** 3).toFixed(2)} GB`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "—");

/** A password shown once: the operator passes it on, the user signs in with it. */
function showPassword(email: string, password: string) {
  void confirmDialog({
    title: `Password for ${email}`,
    body: <><p class="meta">Shown once. Pass it on to them; it works in the Studio and the phone.</p><p class="admin-password num">{password}</p></>,
    confirmLabel: "Done",
  });
}

/**
 * The admin board (issue #116): instance totals, every account (create, block, reset the password,
 * delete) and every workspace with its size. Operators sign in through Cloudflare Access.
 */
export function App() {
  const [me, setMe] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useTheme();
  const load = () => Promise.all([whoami().then(setMe), fetchOverview().then(setOverview), fetchUsers().then(setUsers), fetchWorkspaces().then(setWorkspaces)])
    .then(() => setError(null)).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok); await load(); } catch (e) { toast((e as Error).message, "danger"); }
  };

  return (
    <div class="admin">
      <header class="admin__head">
        <span class="admin__brand"><Mark size={24} surface="admin" />Fielder admin</span>
        <span class="admin__headend">
          <span class="meta">{me ? `Signed in as ${me} (Cloudflare Access) · ` : ""}<span class="num">{__FIELDER_VERSION__} ({__FIELDER_COMMIT__})</span></span>
          <IconButton icon={THEME_ICON[theme]} label={THEME_LABEL[theme]} title={THEME_LABEL[theme]} onClick={() => setTheme(THEME_CYCLE[theme])} />
        </span>
      </header>
      {error && <Empty icon="cloud-alert" title="Could not load" actions={<Button onClick={() => void load()}>Try again</Button>}>{error}</Empty>}
      {!error && !overview && <Loading />}
      {overview && (
        <div class="admin__tiles">
          <Tile label="Accounts" value={overview.users} sub={`${overview.active_30d} active in 30 days${overview.blocked ? ` · ${overview.blocked} blocked` : ""}`} />
          <Tile label="Workspaces" value={overview.workspaces} sub={`${overview.projects} projects`} />
          <Tile label="Shots" value={overview.shots} sub={`${overview.photos} photos`} />
          <Tile label="Storage" value={bytes(overview.bytes)} sub={overview.unsized ? `+ ${overview.unsized} photos from before sizes were recorded` : "photos in R2"} />
        </div>
      )}
      {users && <Users users={users} act={act} />}
      {workspaces && <Workspaces list={workspaces} />}
      <ConfirmHost />
      <ToastHost />
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: ComponentChildren; sub: string }) {
  return <div class="admin__tile"><span class="admin__tilelabel">{label}</span><span class="admin__tilevalue num">{value}</span><span class="meta">{sub}</span></div>;
}

function Section({ icon, title, action, children }: { icon: string; title: string; action?: ComponentChildren; children: ComponentChildren }) {
  return <section class="admin__sec"><h2><Icon name={icon} />{title}{action && <span class="admin__secact">{action}</span>}</h2>{children}</section>;
}

function Users({ users, act }: { users: AdminUser[]; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const create = () => act(async () => {
    const r = await createUser(email.trim(), name.trim() || null);
    setEmail(""); setName("");
    showPassword(r.user.email, r.password);
  });
  const reset = async (u: AdminUser) => {
    if (await confirmDialog({ title: `New password for ${u.email}?`, body: "The current one stops working and every session of the account ends.", confirmLabel: "Make a new password" })) {
      await act(async () => showPassword(u.email, await resetPassword(u.id)));
    }
  };
  const block = async (u: AdminUser) => {
    const blocking = u.status === "active";
    if (blocking && !(await confirmDialog({ title: `Block ${u.email}?`, body: "Every session ends now and sign-in is refused until you unblock the account. Its data stays.", confirmLabel: "Block", danger: true }))) return;
    await act(() => patchUser(u.id, { status: blocking ? "blocked" : "active" }), blocking ? `${u.email} is blocked` : `${u.email} can sign in again`);
  };
  const remove = async (u: AdminUser) => {
    if (await confirmDialog({ title: `Delete ${u.email}?`, body: "Only an account whose workspaces hold no projects can go. Its devices, layouts and empty workspaces go with it. This cannot be undone.", confirmLabel: "Delete", danger: true })) {
      await act(() => deleteUser(u.id), `${u.email} deleted`);
    }
  };
  return (
    <Section icon="account-multiple-outline" title={`Accounts · ${users.length}`}>
      <form class="admin__form" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void create(); }}>
        <Input sm type="email" placeholder="Email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} boxStyle={{ flex: "2 1 220px" }} />
        <Input sm placeholder="Name (optional)" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} boxStyle={{ flex: "1 1 160px" }} />
        <Button type="submit" size="sm" icon="account-plus-outline" disabled={!email.trim()}>New account</Button>
      </form>
      <div class="admin__scroll">
        <table class="admin-table">
          <thead><tr><th>Account</th><th>Status</th><th>Sessions</th><th>Last seen</th><th>Workspaces</th><th>Created</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.name ?? u.email}</strong>{u.name && <span class="meta"> {u.email}</span>}{u.no_password && <> <ProjectTag>No password</ProjectTag></>}</td>
                <td>{u.status === "blocked" ? <ProjectTag icon="block-helper">Blocked</ProjectTag> : u.locked_until && Date.parse(u.locked_until) > Date.now() ? <ProjectTag icon="lock-clock">Locked</ProjectTag> : "Active"}</td>
                <td class="num">{u.sessions}</td>
                <td>{day(u.last_seen)}</td>
                <td class="num">{u.workspaces}</td>
                <td>{day(u.created_at)}</td>
                <td class="admin-table__act">
                  <Button size="sm" kind="ghost" icon="pencil-outline" onClick={() => setEditing(u)}>Edit</Button>
                  <Button size="sm" kind="ghost" icon="key-variant" onClick={() => void reset(u)}>Password</Button>
                  <Button size="sm" kind="ghost" icon={u.status === "active" ? "block-helper" : "check-circle-outline"} onClick={() => void block(u)}>{u.status === "active" ? "Block" : "Unblock"}</Button>
                  <Button size="sm" kind="danger" icon="delete-outline" onClick={() => void remove(u)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EditUser user={editing} onSaved={(email) => { setEditing(null); void act(async () => {}, `Saved ${email}`); }} onClose={() => setEditing(null)} />}
    </Section>
  );
}

/** Email and name of an account (issue #148). The email is what they sign in with from now on; their sessions stay. */
function EditUser({ user, onSaved, onClose }: { user: AdminUser; onSaved: (email: string) => void; onClose: () => void }) {
  const [email, setEmail] = useState(user.email);
  const [name, setName] = useState(user.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const patch: { email?: string; name?: string | null } = {};
    if (email.trim() !== user.email) patch.email = email.trim();
    if ((name.trim() || null) !== user.name) patch.name = name.trim() || null;
    if (!Object.keys(patch).length) { onClose(); return; }
    setBusy(true);
    // A refusal (409: the email is taken) stays in the dialog.
    try { await patchUser(user.id, patch); onSaved(email.trim()); } catch (e) { setError((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title={`Edit ${user.email}`} width="min(440px, 94vw)" onClose={onClose} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <form onSubmit={(e) => { e.preventDefault(); if (email.trim()) void save(); }}>
        <div class="f-modal__body" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <Field label="Email" help="What they sign in with. Tell them when it changes; their sessions stay."><Input type="email" autoFocus value={email} disabled={busy} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></Field>
          <Field label="Name"><Input value={name} maxLength={80} placeholder="Optional" disabled={busy} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
          {error && <ErrorLine>{error}</ErrorLine>}
        </div>
        <div class="f-modal__foot">
          <span class="f-grow" />
          <Button kind="ghost" kbd="Esc" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon="check" disabled={busy || !email.trim()}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

function Workspaces({ list }: { list: AdminWorkspace[] }) {
  return (
    <Section icon="account-group-outline" title={`Workspaces · ${list.length}`}>
      <div class="admin__scroll">
        <table class="admin-table">
          <thead><tr><th>Workspace</th><th>Owner</th><th>Members</th><th>Projects</th><th>Shots</th><th>Photos</th><th>Storage</th><th>Created</th></tr></thead>
          <tbody>
            {list.map((w) => (
              <tr key={w.id}>
                <td><strong>{w.name}</strong> {w.kind === "personal" && <ProjectTag>Personal</ProjectTag>}</td>
                <td>{w.owner_email ?? "—"}</td>
                <td class="num">{w.members}</td>
                <td class="num">{w.projects}</td>
                <td class="num">{w.shots}</td>
                <td class="num">{w.photos}</td>
                <td class="num" title={w.unsized ? `${w.unsized} photos have no recorded size` : undefined}>{bytes(w.bytes)}{w.unsized ? " +" : ""}</td>
                <td>{day(w.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
