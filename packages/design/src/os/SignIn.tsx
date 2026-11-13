import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import { Button } from "../actions/Button";
import { PasswordInput } from "../forms/PasswordInput";
import { TextInput } from "../forms/TextInput";
import { FormField } from "../layout/FormField";
import { cx } from "../util";
import { EnvMarker } from "./EnvMarker";

/** The sign-in boot screen. */
export interface SignInProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onSubmit"> {
  env?: "production" | "staging" | "development";
  error?: ComponentChildren;
  loading?: boolean;
  onSubmit?: (v: { email: string; password: string }) => void;
}

export function SignIn({ env, error, loading, onSubmit, className, ...rest }: SignInProps) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  return (
    <div className={cx("oc-boot", className)} {...rest}>
      <form className="oc-boot__panel" onSubmit={(e) => { e.preventDefault(); if (onSubmit) onSubmit({ email, password: pw }); }}>
        <div className="oc-boot__head"><span className="oc-boot__brand">OpenClapper</span>{env && env !== "production" && <EnvMarker env={env} />}</div>
        <p className="oc-boot__sub">Sign in to the Studio</p>
        <FormField label="Email" htmlFor="oc-signin-email"><TextInput id="oc-signin-email" type="email" autoComplete="username" value={email} onInput={(e) => setEmail(e.currentTarget.value)} /></FormField>
        <FormField label="Password" htmlFor="oc-signin-pw" error={error}><PasswordInput id="oc-signin-pw" autoComplete="current-password" invalid={!!error} value={pw} onInput={(e) => setPw(e.currentTarget.value)} /></FormField>
        <Button variant="primary" type="submit" loading={loading}>Sign in</Button>
      </form>
    </div>
  );
}
