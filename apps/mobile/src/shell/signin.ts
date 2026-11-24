import { isSignedIn, onAuthChange } from "../auth";
import { isConfigured } from "../config";
import { persisted } from "../store";

/**
 * What the sign-in gate shows: the gate itself, the form opened from it, the form opened from inside
 * the app (cancel returns there), or nothing. Someone who chose to go on without an account is not
 * asked again at every start; losing a session (a 401) shows the gate again.
 */
export type Login = "gate" | "form" | "formFromApp" | null;
export const skipped = persisted<boolean>("signinSkipped.v1", false);
export const login = persisted<Login>("login.v1", null);

export function initialLogin() {
  login.set(isConfigured && !isSignedIn() && !skipped.get() ? "gate" : null);
  onAuthChange(() => {
    if (isSignedIn()) { skipped.set(false); login.set(null); }
    else if (isConfigured) login.set("gate");
  });
}
export const startSignIn = () => login.set("formFromApp");
