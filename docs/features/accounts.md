# Accounts and workspaces

Epic [#107](https://github.com/OpenClapper-dev/core/issues/107). OpenClapper has users, and every project belongs to a **workspace**. One instance (one Worker with its D1 and R2) is a closed world: users, workspaces and data never reach another instance.

## Accounts

- **Sign-in** is email + password (`apps/worker/src/authn/`). There is no sign-up during the alpha: `#/register` says so. Accounts are made by an administrator: the admin board (#116), or `node scripts/user.mjs --email … [--remote]` ([development](../development.md)).
- **Sessions** are opaque tokens, stored hashed. The Studio keeps its session in an HttpOnly cookie for 30 days; the phone keeps a bearer token for 180 days. Both slide while in use. A session that ends (it expires, or the account is blocked or signed out elsewhere) shows the sign-in page at the next request.
- After 5 wrong passwords in a row the account locks for 1 minute, doubling up to an hour. The message for an unknown email and for a wrong password is the same.
- **Changing one's password** (#148): Settings › Account in the Studio, Setup › Account › Change password on the phone. The current password, then the new one twice (at least 10 characters, the same rule as everywhere). A wrong current password counts towards the same lock as sign-in. Every other session of the account ends; the one that changed it stays signed in. Only an administrator can change an account's email or name (admin board › Edit).
- **The bootstrap user** owns everything from before accounts (migration 0021). On an instance from before accounts, `node scripts/user.mjs --bootstrap --email … --remote` gives it an email and a password ([infrastructure](../infrastructure.md)).

## Workspaces

- Every user has a **personal** workspace. It is where new projects and rigs go unless another workspace is named.
- A user can create **shared** workspaces and add other accounts of the same instance by email, each with a role:

  | Role | Can |
  | --- | --- |
  | Viewer | look at every project of the workspace |
  | Editor | also change content: shots, uploads, projects, locations, days, timelines, drawings, the recycle bin |
  | Admin | also add, re-role and remove editors and viewers, rename the workspace |
  | Owner | also manage admins; cannot leave, and is never removed or re-roled here |

  Anyone can leave a workspace they do not own.
- **What belongs where:**
  - Projects and rigs belong to a workspace. Everything inside a project follows its project.
  - Devices and viewfinder layouts belong to a user. A phone is a person's; a phone signed in to another account takes its device row over.
  - Shots, timelines and days never move to a project of another workspace.
- **Lists** (projects, shots, locations, …) cover all of the caller's workspaces, so the phone and the Studio need no workspace picker. A row of a workspace you are not in answers like a missing one (404). The rules are in [api](../api.md#sign-in-authn-epic-107).

## Studio

- **Sign-in page** (`SignIn.tsx`): an eye button in the password field shows what was typed (hidden again each time). Shown by the shell (`wm/Shell.tsx`) while `user.ts` knows no user. Signing in as another account starts from a fresh data cache. Window layouts are per browser and project, so they come back.
- **Taskbar**: the account button (last in the tray) shows who is signed in, and opens Account and workspaces or signs out. The palette (⌘K) has the same two entries.
- **Settings › Account** (`AccountSettings.tsx`, `#/settings/account`):
  - Who is signed in, and Sign out.
  - Change password: a dialog with the current password and the new one twice (eye buttons as on the sign-in page).
  - Every workspace with your role and its members. Admins get a role picker per member and an invite form (email + role).
  - Remove or Leave, after a confirm.
  - New project here, Rename (shared workspaces, admins), and New workspace.
- **Library › Projects** names each project's workspace once you are in more than one.

Naming: the desktop's virtual desktops (task view) are also called "workspaces" in the shell. The two are unrelated.
