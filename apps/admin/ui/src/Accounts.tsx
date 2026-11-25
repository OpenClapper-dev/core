/** The Accounts section (issue #116): every account, create, edit, reset the password, block, delete. */
import { useState } from "preact/hooks";
import { Badge, Button, Dialog, FormField, Table, TextInput } from "@openclapper/design";
import { createUser, deleteUser, patchUser, resetPassword, type AdminUser } from "./api";
import { confirm } from "./hosts";
import { day, Section } from "./shared";

export type Act = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

/** A password shown once: the operator passes it on, the user signs in with it. */
function showPassword(email: string, password: string) {
  void confirm({
    title: `Password for ${email}`, only: true, confirmLabel: "Done",
    message: <><p className="adm-meta">Shown once. Pass it on to them; it works in the Studio and the phone.</p><p className="adm-password">{password}</p></>,
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
    if (await confirm({ title: `New password for ${u.email}?`, message: "The current one stops working and every session of the account ends.", confirmLabel: "Make a new password" })) {
      await act(async () => showPassword(u.email, await resetPassword(u.id)));
    }
  };
  const block = async (u: AdminUser) => {
    const blocking = u.status === "active";
    if (blocking && !(await confirm({ title: `Block ${u.email}?`, message: "Every session ends now and sign-in is refused until you unblock the account. Its data stays.", confirmLabel: "Block", danger: true }))) return;
    await act(() => patchUser(u.id, { status: blocking ? "blocked" : "active" }), blocking ? `${u.email} is blocked` : `${u.email} can sign in again`);
  };
  const remove = async (u: AdminUser) => {
    if (await confirm({ title: `Delete ${u.email}?`, message: "Only an account whose workspaces hold no projects can go. Its devices, layouts and empty workspaces go with it. This cannot be undone.", confirmLabel: "Delete", danger: true })) {
      await act(() => deleteUser(u.id), `${u.email} deleted`);
    }
  };
  return (
    <Section icon="users" title={`Accounts · ${users.length}`}>
      <form className="adm-form" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void create(); }}>
        <TextInput size="sm" type="email" placeholder="Email" aria-label="Email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} style={{ flex: "2 1 220px" }} />
        <TextInput size="sm" placeholder="Name (optional)" aria-label="Name" value={name} onInput={(e) => setName(e.currentTarget.value)} style={{ flex: "1 1 160px" }} />
        <Button type="submit" size="sm" variant="primary" icon="plus" disabled={!email.trim()}>New account</Button>
      </form>
      <div className="adm-scroll">
        <Table columns={[{ key: "who", label: "Account" }, { key: "status", label: "Status", width: 110 }, { key: "sessions", label: "Sessions", numeric: true, width: 90 }, { key: "seen", label: "Last seen", width: 130 }, { key: "ws", label: "Workspaces", numeric: true, width: 110 }, { key: "created", label: "Created", width: 130 }, { key: "act", label: "", width: 380 }]}
          rows={users.map((u) => ({
            id: u.id,
            who: <span className="adm-who"><strong>{u.name ?? u.email}</strong>{u.name && <span className="adm-meta">{u.email}</span>}{u.no_password && <Badge>No password</Badge>}</span>,
            status: u.status === "blocked" ? <Badge tone="danger" icon="ban">Blocked</Badge> : "Active",
            sessions: u.sessions, seen: day(u.last_seen), ws: u.workspaces, created: day(u.created_at),
            act: (
              <span className="adm-act">
                <Button size="sm" variant="quiet" icon="edit" onClick={() => setEditing(u)}>Edit</Button>
                <Button size="sm" variant="quiet" icon="lock" onClick={() => void reset(u)}>Password</Button>
                <Button size="sm" variant="quiet" icon={u.status === "active" ? "ban" : "check"} onClick={() => void block(u)}>{u.status === "active" ? "Block" : "Unblock"}</Button>
                <Button size="sm" variant="danger" icon="trash" onClick={() => void remove(u)}>Delete</Button>
              </span>
            ),
          }))} />
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
    <Dialog fixed title={`Edit ${user.email}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon="check" disabled={busy || !email.trim()} onClick={() => void save()}>Save</Button></>}>
      <form className="adm-dialog" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void save(); }}>
        <FormField label="Email" htmlFor="adm-email" hint="What they sign in with. Tell them when it changes; their sessions stay." error={error ?? undefined}>
          <TextInput id="adm-email" type="email" autoFocus value={email} disabled={busy} invalid={!!error} onInput={(e) => { setEmail(e.currentTarget.value); setError(null); }} />
        </FormField>
        <FormField label="Name" htmlFor="adm-name"><TextInput id="adm-name" value={name} maxLength={80} placeholder="Optional" disabled={busy} onInput={(e) => setName(e.currentTarget.value)} /></FormField>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
