// UX workshop U1: changing naming patterns with an AI. The same three steps as for properties (AiEdit.tsx): ask,
// paste the answer, review. The review shows each changed pattern now and after, with the name the next file would
// get; a pattern with a token that does not exist cannot be applied.
import { useState } from "preact/hooks";
import { AppIcon, Button, Checkbox, Dialog, Icon, TextArea, cx } from "@openclapper/design";
import { TYPES, type FileType } from "./data";
import { PHOTO_ONLY, TOKENS, TOKEN_MEANS, PatternView, check, nameFor, type Pattern } from "./naming";

interface Entry { type?: string; pattern?: string; digits?: number }
interface Item { key: string; type: FileType; before: Pattern; after: Pattern; problems: string[]; same: boolean }

export function buildPrompt(request: string, patterns: Record<string, Pattern>): string {
  const types = Object.keys(patterns) as FileType[];
  return `You are helping to set up how new files are named in a film project in OpenClapper.
Every file type has a naming pattern. When a file is made, its name is built from the pattern.
Names can be changed afterwards and need not be unique.

TASK
Change the naming patterns as the request asks. Give only the file types whose pattern or digits change.

REQUEST
${request.trim() || "(write here what you need)"}

TOKENS
A token is written in braces and is replaced when the name is built. These exist, and no others:
${TOKENS.map((t) => `- {${t}}: ${TOKEN_MEANS[t]}${PHOTO_ONLY.includes(t) ? " (photos only)" : ""}`).join("\n")}
Everything outside braces is kept as written. {counter} should be in every pattern, so names differ.

THE PATTERNS NOW
${JSON.stringify(types.map((t) => ({ type: t, pattern: patterns[t].pattern, digits: patterns[t].digits })), null, 1)}

ANSWER FORMAT
Answer with one JSON array and nothing else: no explanation, no code fence. Each entry is an object:
- "type": one of ${types.map((t) => `"${t}"`).join(", ")}.
- "pattern": the new pattern.
- "digits": 1 to 5, how many digits {counter} is padded to.

EXAMPLE OF THE FORM (not of the content)
[ { "type": "shot", "pattern": "Shot {counter}", "digits": 3 } ]`;
}

const SAMPLE = `[
 { "type": "photo", "pattern": "{date} {device} {counter}", "digits": 4 },
 { "type": "shot", "pattern": "SH{counter}", "digits": 3 },
 { "type": "canvas", "pattern": "{type} {focal} {counter}", "digits": 2 },
 { "type": "timeline", "pattern": "Cut {counter} {day}", "digits": 2 }
]`;

function read(answer: string, patterns: Record<string, Pattern>): { items: Item[]; stray: string[]; error: string } {
  const body = answer.trim().replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  if (!body) return { items: [], stray: [], error: "" };
  let list: Entry[];
  try { const j = JSON.parse(body); if (!Array.isArray(j)) return { items: [], stray: [], error: "The answer is not a list. It has to start with [ and end with ]." }; list = j; } catch (e) { return { items: [], stray: [], error: `The answer cannot be read as JSON: ${(e as Error).message}` }; }
  const stray = list.filter((e) => !e.type || !(e.type in patterns)).map((e) => `“${e.type ?? "?"}” is not a file type with a naming pattern.`);
  const items = list.filter((e) => e.type && e.type in patterns).map((e, i): Item => {
    const type = e.type as FileType, before = patterns[type];
    const digits = Number.isInteger(e.digits) && e.digits! >= 1 && e.digits! <= 5 ? e.digits! : before.digits;
    const after = { ...before, pattern: typeof e.pattern === "string" ? e.pattern : before.pattern, digits };
    const problems = [...check(type, after.pattern), ...(e.digits != null && digits !== e.digits ? [`${e.digits} digits is not possible; 1 to 5 are.`] : []), ...(after.pattern.trim() === "" ? ["The pattern is empty."] : [])];
    return { key: `${i}`, type, before, after, problems, same: before.pattern === after.pattern && before.digits === after.digits };
  });
  return { items, stray, error: "" };
}

export default function AiNames({ patterns, onApply, onClose, say }: { patterns: Record<string, Pattern>; onApply: (next: Record<string, Pattern>, summary: string) => void; onClose: () => void; say: (m: string) => void }) {
  const [step, setStep] = useState(1);
  const [request, setRequest] = useState("");
  const [answer, setAnswer] = useState("");
  const [skip, setSkip] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const prompt = buildPrompt(request, patterns);
  const { items, stray, error } = read(answer, patterns);
  const good = items.filter((i) => !i.problems.length && !i.same), bad = items.filter((i) => i.problems.length), same = items.filter((i) => i.same && !i.problems.length);
  const take = good.filter((i) => !skip.includes(i.key));
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { const el = document.querySelector<HTMLTextAreaElement>(".u1a-prompt"); el?.focus(); el?.select(); say("The browser did not allow copying: the prompt is selected, press Ctrl+C"); }
  };
  const row = (i: Item, usable: boolean) => (
    <article key={i.key} className={cx("u1a-card", skip.includes(i.key) && "is-skipped", !usable && "is-bad")}>
      <header>{usable ? <Checkbox checked={!skip.includes(i.key)} onChange={() => setSkip(skip.includes(i.key) ? skip.filter((k) => k !== i.key) : [...skip, i.key])}>Apply</Checkbox> : <Icon name="warning" />}<AppIcon glyph={TYPES[i.type].glyph} color={TYPES[i.type].color} size={20} /><strong>{TYPES[i.type].plural}</strong></header>
      <div className="u1a-ab">
        <div><span className="u1a-cap">Now</span><PatternView value={i.before.pattern} type={i.type} /><span className="u1a-name">Next file: <strong>{nameFor(i.type, i.before)}</strong></span></div>
        <Icon name="arrow-right" />
        <div><span className="u1a-cap">After</span><PatternView value={i.after.pattern} type={i.type} />{usable ? <span className="u1a-name">Next file: <strong>{nameFor(i.type, i.after)}</strong></span> : <span className="u1a-name">Cannot be used</span>}</div>
      </div>
      {usable && i.before.digits !== i.after.digits && <ul className="u1a-changes"><li><span className="u1a-changes__what">Digits</span><span><s>{i.before.digits}</s> <Icon name="arrow-right" size={12} /> <b>{i.after.digits}</b></span></li></ul>}
      {!usable && <ul className="u1a-problems">{i.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </article>
  );

  return (
    <Dialog fixed className="u1a" title="Edit naming patterns with AI" onClose={onClose}
      footer={<>
        <span className="u1a-steps">{["Ask", "Paste the answer", "Review"].map((s, n) => <span key={s} className={cx(step === n + 1 && "is-on", step > n + 1 && "is-done")}>{n + 1} · {s}</span>)}</span>
        <span style={{ flex: 1 }} />
        {step > 1 ? <Button onClick={() => setStep(step - 1)}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
        {step === 1 && <Button variant="primary" onClick={() => setStep(2)}>Next: paste the answer</Button>}
        {step === 2 && <Button variant="primary" disabled={!items.length} onClick={() => { setSkip([]); setStep(3); }}>Next: review</Button>}
        {step === 3 && <Button variant="primary" disabled={!take.length} onClick={() => { const next = { ...patterns }; for (const i of take) next[i.type] = i.after; onApply(next, `${take.length} ${take.length === 1 ? "pattern" : "patterns"} changed`); }}>{take.length ? `Apply ${take.length} ${take.length === 1 ? "pattern" : "patterns"}` : "Nothing to apply"}</Button>}
      </>}>
      {step === 1 && (
        <div className="u1a-grid">
          <div className="u1a-col">
            <span className="u1a-cap">What do you need?</span>
            <TextArea rows={9} value={request} placeholder="For example: photos should start with the date and the device; shots should be SH and three digits." onInput={(e) => setRequest((e.target as HTMLTextAreaElement).value)} />
            <p className="u1a-note">Your words are put into the prompt on the right, together with the tokens that exist and the {Object.keys(patterns).length} patterns as they are now. Only existing files keep their names: a pattern applies to files made from then on.</p>
          </div>
          <div className="u1a-col">
            <span className="u1a-cap">The prompt <span>· {prompt.length.toLocaleString("en")} characters</span></span>
            <TextArea readOnly className="u1a-prompt" value={prompt} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} />
            <div className="u1a-row"><Button variant="primary" icon={copied ? "check" : "copy"} onClick={copy}>{copied ? "Copied" : "Copy the prompt"}</Button><span className="u1a-note">Paste it into the AI of your choice.</span></div>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="u1a-col">
          <span className="u1a-cap">The AI's answer</span>
          <TextArea className="u1a-answer" value={answer} invalid={!!error} placeholder="[ … ]" spellcheck={false} onInput={(e) => setAnswer((e.target as HTMLTextAreaElement).value)} />
          <div className="u1a-row">
            <Button size="sm" variant="quiet" onClick={() => setAnswer(SAMPLE)}>Use a sample answer</Button>
            {error ? <span className="u1a-bad"><Icon name="warning" size={12} /> {error}</span> : items.length > 0 && <span className="u1a-note">{good.length} changed{bad.length > 0 && `, ${bad.length} cannot be used`}{same.length > 0 && `, ${same.length} unchanged`}</span>}
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="u1a-review">
          <p className="u1a-summary"><strong>Changing naming patterns.</strong> {good.length} changed, {Object.keys(patterns).length - good.length} untouched. Files that exist keep their names. Untick what you do not want.</p>
          {good.length > 0 && <><h3>Changed · now and after</h3>{good.map((i) => row(i, true))}</>}
          {bad.length > 0 && <><h3>Cannot be used</h3>{bad.map((i) => row(i, false))}</>}
          {(same.length > 0 || stray.length > 0) && <><h3>Left out</h3><ul className="u1a-problems u1a-problems--quiet">{same.map((i) => <li key={i.key}>{TYPES[i.type].plural}: nothing would change.</li>)}{stray.map((m) => <li key={m}>{m}</li>)}</ul></>}
        </div>
      )}
    </Dialog>
  );
}
