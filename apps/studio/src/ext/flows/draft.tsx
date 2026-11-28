// A text field over a value that is cleaned on the way in (trimmed, never empty): while it has focus the field shows
// what is typed, a trailing space or an empty field included, and each keystroke still saves the cleaned value; on
// leaving it shows the stored value again (#426: a space could not be typed after a word in a track's name).
import type { JSX } from "preact";
import { useState } from "preact/hooks";

export interface DraftField { value: string; onInput: (e: JSX.TargetedEvent<HTMLInputElement>) => void; onBlur: () => void }

export function Draft({ value, commit, children }: { value: string; commit: (typed: string) => void; children: (field: DraftField) => JSX.Element }) {
  const [draft, setDraft] = useState<string | null>(null);
  return children({ value: draft ?? value, onInput: (e) => { const v = e.currentTarget.value; setDraft(v); commit(v); }, onBlur: () => setDraft(null) });
}
