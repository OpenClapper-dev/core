// Naming patterns in the U1 prototype: the tokens, their validation, and a pattern shown with its tokens in boxes.
import { cx } from "@openclapper/design";
import { TYPES, type FileType } from "./data";

export interface Pattern { pattern: string; digits: number; next: number }
export const PATTERNS: Record<string, Pattern> = { photo: { pattern: "{type} {counter}", digits: 4, next: 145 }, shot: { pattern: "{type} {counter}", digits: 2, next: 11 }, canvas: { pattern: "{type} {counter}", digits: 2, next: 6 }, collection: { pattern: "{date} {type} {counter}", digits: 1, next: 3 }, set: { pattern: "{type} {counter}", digits: 1, next: 5 }, location: { pattern: "{type} {counter}", digits: 1, next: 5 }, timeline: { pattern: "Cut {counter}", digits: 1, next: 3 } };
export const TOKENS = ["type", "counter", "date", "time", "device", "focal"];
export const PHOTO_ONLY = ["device", "focal"];
export const TOKEN_MEANS: Record<string, string> = { type: "the file type's name, e.g. Photo", counter: "a running number per file type, padded to the number of digits", date: "the day the file is made, 2026-11-20", time: "the time the file is made, 14:32", device: "the device that took the photo", focal: "the photo's focal length" };

/** The name the next file of a type gets from its pattern. */
export const nameFor = (t: FileType, p: Pattern) => p.pattern.replace("{type}", TYPES[t].label).replace("{counter}", String(p.next).padStart(p.digits, "0")).replace("{date}", "2026-11-20").replace("{time}", "14:32").replace("{device}", "Pixel 9 Pro").replace("{focal}", "24 mm");
/** What is wrong with a token on a file type, or null when it is fine. */
export const tokenProblem = (token: string, t: FileType) => (!TOKENS.includes(token) ? `{${token}} is not a token.` : PHOTO_ONLY.includes(token) && t !== "photo" ? `{${token}} only works on photos.` : null);
export const check = (t: FileType, pattern: string) => [...new Set([...pattern.matchAll(/\{([^{}]*)\}/g)].map((m) => tokenProblem(m[1], t)).filter((m): m is string => !!m))];

/** A pattern's text with each {token} in a box: accent when it exists, danger and underlined when it does not or does not apply. */
export function PatternText({ value, type }: { value: string; type: FileType }) {
  return <>{value.split(/(\{[^{}]*\})/g).filter((x) => x !== "").map((x, n) => (/^\{[^{}]*\}$/.test(x) ? <mark key={n} className={cx(tokenProblem(x.slice(1, -1), type) && "is-bad")}>{x}</mark> : <span key={n}>{x}</span>))}</>;
}

/** A pattern field that shows its tokens. The boxes are drawn behind a transparent input, so typing and the caret behave as in any text field. */
export function PatternInput({ value, type, label, onChange, onFocus }: { value: string; type: FileType; label: string; onChange: (v: string) => void; onFocus: () => void }) {
  const bad = check(type, value).length > 0;
  return (
    <span className={cx("u1p-pattern", bad && "is-bad")}>
      <span className="u1p-pattern__back" aria-hidden="true"><PatternText value={value} type={type} /></span>
      <input data-pattern={type} value={value} aria-label={label} aria-invalid={bad || undefined} spellcheck={false} onFocus={onFocus} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
    </span>
  );
}

/** A pattern shown, not edited: the same boxes, on one line. */
export const PatternView = ({ value, type }: { value: string; type: FileType }) => <span className="u1p-patternview"><PatternText value={value} type={type} /></span>;
