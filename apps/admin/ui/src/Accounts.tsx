/** The Accounts section (issue #116): every account, create, edit, reset the password, block, delete. */
import { useState } from "preact/hooks";
import { Button, confirmDialog, ErrorLine, Field, Input, Modal, ProjectTag } from "@openclapper/ui";
import { createUser, deleteUser, patchUser, resetPassword, type AdminUser } from "./api";
import { day, Section } from "./shared";

export type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

/** A password shown once: the operator passes it on, the user signs in with it. */
function showPassword(email: string, password: string) {
  void confirmDialog({
    title: `Password for ${email}`,
    body: <><p class="meta">Shown once. Pass it on to them; it works in the Studio and the phone.</p><p class="admin-password num">{password}</p></>,
    confirmLabel: "Done",
  });
}

export function Users({ users, act }: { users: AdminUser[]; act: Act }) {
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
