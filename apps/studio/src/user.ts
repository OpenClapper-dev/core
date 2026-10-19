import { useEffect, useState } from "preact/hooks";
import { fetchMe, setUnauthorizedHandler, signIn as apiSignIn, signOut as apiSignOut, type Me } from "./api";

/**
 * Who is signed in (epic #107). The shell shows the sign-in page until this knows a user; any API
 * call answering 401 later (session expired, signed out elsewhere) brings it back. Windows and
 * their layout are kept per browser, so signing in again returns to the same desktop.
 */
export type UserState =
  | { status: "checking" }
  | { status: "signed-out" }
  | { status: "error"; message: string }
  | { status: "signed-in"; me: Me };

let state: UserState = { status: "checking" };
const listeners = new Set<(s: UserState) => void>();
function put(s: UserState) {
  state = s;
  for (const cb of listeners) cb(s);
}
export const getUser = () => state;

setUnauthorizedHandler(() => { if (state.status === "signed-in") put({ status: "signed-out" }); });

/** Ask the Worker who this browser is; network trouble is an error with a retry, not a sign-out. */
export async function boot(): Promise<void> {
  try {
    const me = await fetchMe();
    put(me ? { status: "signed-in", me } : { status: "signed-out" });
  } catch (e) {
    put({ status: "error", message: (e as Error).message });
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  await apiSignIn(email, password);
  await boot();
}

export async function signOut(): Promise<void> {
  await apiSignOut().catch(() => {});
  put({ status: "signed-out" });
}

export function useUser(): UserState {
  const [s, set] = useState(state);
  useEffect(() => { listeners.add(set); set(state); return () => { listeners.delete(set); }; }, []);
  return s;
}
