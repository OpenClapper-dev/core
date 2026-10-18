import { useEffect, useState } from "preact/hooks";
import { ApiError } from "./api";
import { Button, ErrorLine, Field, Input, Mark } from "./ui";
import { signIn } from "./user";

const REGISTER = "#/register";

/** What a failed sign-in tells the user: the server's words for a lock or a block, ours for the rest. */
function problem(e: unknown): string {
  if (e instanceof ApiError) return e.status === 401 ? "Wrong email or password." : e.message;
  return "Could not reach Fielder. Check the connection and try again.";
}

/**
 * The sign-in page (epic #107), shown by the shell until a user is signed in. #/register explains
 * that there is no sign-up yet: accounts are made by an administrator during the alpha.
 */
export function SignInPage() {
  const [register, setRegister] = useState(location.hash === REGISTER);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setRegister(location.hash === REGISTER);
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(problem(err));
      setBusy(false);
    }
  };

  if (register) {
    return (
      <div class="gate">
        <div class="gate__card">
          <span class="gate__brand"><Mark size={26} />Fielder</span>
          <h1>Create an account</h1>
          <p>We are still in alpha, you cannot currently sign up.</p>
          <p class="meta">Accounts are made by an administrator of this Fielder. Ask them for one, or run your own: Fielder is free to host yourself.</p>
          <a href="#/">Back to sign in</a>
        </div>
      </div>
    );
  }
  return (
    <div class="gate">
      <form class="gate__card" onSubmit={submit}>
        <span class="gate__brand"><Mark size={26} />Fielder</span>
        <h1>Sign in</h1>
        <Field label="Email">
          <Input type="email" autocomplete="username" required value={email} disabled={busy} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="Password">
          <Input type="password" autocomplete="current-password" required value={password} disabled={busy} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        </Field>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Button type="submit" icon="login" disabled={busy || !email.trim() || !password}>{busy ? "Signing in…" : "Sign in"}</Button>
        <span class="meta">No account yet? <a href={REGISTER}>Create one</a></span>
      </form>
    </div>
  );
}
