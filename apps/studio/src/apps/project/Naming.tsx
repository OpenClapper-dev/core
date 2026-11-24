// The Project app's naming patterns (docs/features/properties.md#naming-patterns, UX workshop U1 rounds 6
// and 8): a pattern and its digits per file type, the tokens in boxes and checked, the name a file would
// get, and editing them with an AI in the same three steps as the properties.
import { useEffect, useState } from "preact/hooks";
import { AppIcon, Button, Checkbox, Dialog, Icon, Select, TextArea, cx } from "@openclapper/design";
import { MAX_DIGITS, NAME_TOKENS, patternProblems, renderName } from "@openclapper/model";
import type { FileRec } from "../../api";
import { kindOf } from "../../fileKinds";
import { toast, toastError } from "../../hosts";
import { NAMED_TYPES, patternOf, savePattern } from "../../props";
import { PatternInput, PatternView, TOKENS } from "./parts";

type P = { pattern: string; digits: number };
/** The name a pattern gives, with example facts. */
const example = (type: string, p: P) => renderName(p.pattern, p.digits, { type, label: kindOf(type).label, counter: 12, at: new Date(), device: "Pixel 9 Pro", focal: 24 });
const DIGITS = Array.from({ length: MAX_DIGITS }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

export function NamingPage({ projectId, files, patterns }: { projectId: string; files: FileRec[] | null; patterns: FileRec[] }) {
  const stored = Object.fromEntries(NAMED_TYPES.map((t) => { const p = patternOf(patterns, t); return [t, { pattern: p.pattern, digits: p.digits }]; })) as Record<string, P>;
  const [draft, setDraft] = useState(stored);
  const key = JSON.stringify(stored);
  useEffect(() => { setDraft(stored); }, [key]);
  const [editing, setEditing] = useState("shot");
  const [ai, setAi] = useState(false);
  const save = async (t: string, p: P) => {
    if (p.pattern === stored[t].pattern && p.digits === stored[t].digits) return;
    try { await savePattern(projectId, files, patterns, t, p.pattern, p.digits); } catch (e) { toastError(e); }
  };
  /** Puts a token into the pattern last edited, at the caret. */
  const insert = (token: string) => {
    const el = document.querySelector<HTMLInputElement>(`input[data-pattern="${editing}"]`), cur = draft[editing].pattern;
    const at = el?.selectionStart ?? cur.length, end = el?.selectionEnd ?? at, text = `{${token}}`;
    const next = { ...draft[editing], pattern: cur.slice(0, at) + text + cur.slice(end) };
    setDraft({ ...draft, [editing]: next });
    void save(editing, next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + text.length, at + text.length); });
  };
  return (
    <div className="pc-page pc-page--wide">
      <p className="pc-lead">Every new file gets a name from its type's pattern. Names can be changed afterwards and need not be unique; files that exist keep theirs.</p>
      <div className="pc-tokens">Tokens, click one to put it into the pattern you are editing: {TOKENS.map((t) => <button type="button" key={t} title={NAME_TOKENS[t].label} className="pc-token" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(t)}>{`{${t}}`}</button>)}<span>· device and focal only on photos</span><span style={{ flex: 1 }} /><Button size="sm" icon="bulb" onClick={() => setAi(true)}>Edit with AI…</Button></div>
      <div className="pc-names">
        <div className="pc-names__head"><span>File type</span><span>Pattern</span><span>Digits</span><span>A file would be named</span></div>
        {NAMED_TYPES.map((t) => {
          const k = kindOf(t), p = draft[t], problems = patternProblems(p.pattern, t);
          return (
            <div key={t} className="pc-names__row">
              <span className="pc-names__type"><AppIcon glyph={k.glyph} color={k.color} size={20} />{k.label}</span>
              <PatternInput value={p.pattern} type={t} label={`Pattern for ${k.plural.toLowerCase()}`} onFocus={() => setEditing(t)} onBlur={() => void save(t, draft[t])} onChange={(v) => setDraft({ ...draft, [t]: { ...p, pattern: v } })} />
              <Select size="sm" value={String(p.digits)} onChange={(v) => { const next = { ...p, digits: Number(v) }; setDraft({ ...draft, [t]: next }); void save(t, next); }} options={DIGITS} aria-label={`Digits for ${k.plural.toLowerCase()}`} />
              {problems.length ? <span className="pc-names__off"><Icon name="warning" size={12} /> Not in use until the pattern is fixed</span> : <strong>{example(t, p)}</strong>}
              {problems.map((m) => <p key={m} className="pc-names__problem">{m}</p>)}
            </div>
          );
        })}
      </div>
      {ai && <AiNames patterns={stored} onClose={() => setAi(false)} onApply={async (changes) => {
        try { for (const [t, p] of Object.entries(changes)) await savePattern(projectId, files, patterns, t, p.pattern, p.digits); toast(`Naming: ${Object.keys(changes).length} ${Object.keys(changes).length === 1 ? "pattern" : "patterns"} changed`); setAi(false); }
        catch (e) { toastError(e); }
      }} />}
    </div>
  );
}

interface Item { key: string; type: string; before: P; after: P; problems: string[]; same: boolean }

function buildPrompt(request: string, patterns: Record<string, P>): string {
  const types = Object.keys(patterns);
  return `You are helping to set up how new files are named in a film project in OpenClapper.
Every file type has a naming pattern. When a file is made, its name is built from the pattern.
Names can be changed afterwards and need not be unique.

TASK
Change the naming patterns as the request asks. Give only the file types whose pattern or digits change.

REQUEST
${request.trim() || "(write here what you need)"}

TOKENS
A token is written in braces and is replaced when the name is built. These exist, and no others:
${TOKENS.map((t) => `- {${t}}: ${NAME_TOKENS[t].label}${NAME_TOKENS[t].photoOnly ? " (photos only)" : ""}`).join("\n")}
Everything outside braces is kept as written. {counter} should be in every pattern, so names differ.

THE PATTERNS NOW
${JSON.stringify(types.map((t) => ({ type: t, pattern: patterns[t].pattern, digits: patterns[t].digits })), null, 1)}

ANSWER FORMAT
Answer with one JSON array and nothing else: no explanation, no code fence. Each entry is an object:
- "type": one of ${types.map((t) => `"${t}"`).join(", ")}.
- "pattern": the new pattern.
- "digits": 1 to ${MAX_DIGITS}, how many digits {counter} is padded to.

EXAMPLE OF THE FORM (not of the content)
[ { "type": "shot", "pattern": "Shot {counter}", "digits": 3 } ]`;
}

function read(answer: string, patterns: Record<string, P>): { items: Item[]; stray: string[]; error: string } {
  const body = answer.trim().replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  if (!body) return { items: [], stray: [], error: "" };
  let list: { type?: unknown; pattern?: unknown; digits?: unknown }[];
  try { const j = JSON.parse(body) as unknown; if (!Array.isArray(j)) return { items: [], stray: [], error: "The answer is not a list. It has to start with [ and end with ]." }; list = j as typeof list; }
  catch (e) { return { items: [], stray: [], error: `The answer cannot be read as JSON: ${(e as Error).message}` }; }
  const known = (e: (typeof list)[number]) => typeof e?.type === "string" && e.type in patterns;
  const stray = list.filter((e) => !known(e)).map((e) => `“${String(e?.type ?? "?")}” is not a file type with a naming pattern.`);
  const items = list.filter(known).map((e, i): Item => {
    const type = e.type as string, before = patterns[type];
    const d = Number(e.digits);
    const digits = Number.isInteger(d) && d >= 1 && d <= MAX_DIGITS ? d : before.digits;
    const after = { pattern: typeof e.pattern === "string" ? e.pattern.slice(0, 80) : before.pattern, digits };
    const problems = [...patternProblems(after.pattern, type), ...(e.digits != null && digits !== d ? [`${String(e.digits)} digits is not possible; 1 to ${MAX_DIGITS} are.`] : [])];
    return { key: `${i}`, type, before, after, problems, same: before.pattern === after.pattern && before.digits === after.digits };
  });
  return { items, stray, error: "" };
}

function AiNames({ patterns, onApply, onClose }: { patterns: Record<string, P>; onApply: (changes: Record<string, P>) => Promise<void>; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [request, setRequest] = useState("");
  const [answer, setAnswer] = useState("");
  const [skip, setSkip] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const prompt = buildPrompt(request, patterns);
  const { items, stray, error } = read(answer, patterns);
  const good = items.filter((i) => !i.problems.length && !i.same), bad = items.filter((i) => i.problems.length), same = items.filter((i) => i.same && !i.problems.length);
  const take = good.filter((i) => !skip.includes(i.key));
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { const el = document.querySelector<HTMLTextAreaElement>(".ai-prompt"); el?.focus(); el?.select(); toast("The browser did not allow copying: the prompt is selected, press Ctrl+C", { tone: "warning" }); }
  };
  const row = (i: Item, usable: boolean) => { const k = kindOf(i.type); return (
    <article key={i.key} className={cx("ai-card", skip.includes(i.key) && "is-skipped", !usable && "is-bad")}>
      <header>{usable ? <Checkbox checked={!skip.includes(i.key)} onChange={() => setSkip(skip.includes(i.key) ? skip.filter((x) => x !== i.key) : [...skip, i.key])}>Apply</Checkbox> : <Icon name="warning" />}<AppIcon glyph={k.glyph} color={k.color} size={20} /><strong>{k.plural}</strong></header>
      <div className="ai-ab">
        <div><span className="ai-cap">Now</span><PatternView value={i.before.pattern} type={i.type} /><span className="ai-name">A file: <strong>{example(i.type, i.before)}</strong></span></div>
        <Icon name="arrow-right" />
        <div><span className="ai-cap">After</span><PatternView value={i.after.pattern} type={i.type} />{usable ? <span className="ai-name">A file: <strong>{example(i.type, i.after)}</strong></span> : <span className="ai-name">Cannot be used</span>}</div>
      </div>
      {usable && i.before.digits !== i.after.digits && <ul className="ai-changes"><li><span className="ai-changes__what">Digits</span><span><s>{i.before.digits}</s> <Icon name="arrow-right" size={12} /> <b>{i.after.digits}</b></span></li></ul>}
      {!usable && <ul className="ai-problems">{i.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </article>
  ); };
  return (
    <Dialog fixed className="ai" title="Edit naming patterns with AI" onClose={onClose}
      footer={<>
        <span className="ai-steps">{["Ask", "Paste the answer", "Review"].map((s, n) => <span key={s} className={cx(step === n + 1 && "is-on", step > n + 1 && "is-done")}>{n + 1} · {s}</span>)}</span>
        <span style={{ flex: 1 }} />
        {step > 1 ? <Button onClick={() => setStep(step - 1)}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
        {step === 1 && <Button variant="primary" onClick={() => setStep(2)}>Next: paste the answer</Button>}
        {step === 2 && <Button variant="primary" disabled={!items.length} onClick={() => { setSkip([]); setStep(3); }}>Next: review</Button>}
        {step === 3 && <Button variant="primary" disabled={!take.length || busy} onClick={() => { setBusy(true); void onApply(Object.fromEntries(take.map((i) => [i.type, i.after]))).finally(() => setBusy(false)); }}>{take.length ? `Apply ${take.length} ${take.length === 1 ? "pattern" : "patterns"}` : "Nothing to apply"}</Button>}
      </>}>
      {step === 1 && (
        <div className="ai-grid">
          <div className="ai-col">
            <span className="ai-cap">What do you need?</span>
            <TextArea rows={9} value={request} placeholder="For example: photos should start with the date and the device; shots should be SH and three digits." onInput={(e) => setRequest(e.currentTarget.value)} />
            <p className="ai-note">Your words are put into the prompt on the right, together with the tokens that exist and the {Object.keys(patterns).length} patterns as they are now. Files that exist keep their names: a pattern applies to files made from then on.</p>
          </div>
          <div className="ai-col">
            <span className="ai-cap">The prompt <span>· {prompt.length.toLocaleString("en")} characters</span></span>
            <TextArea readOnly className="ai-prompt" value={prompt} onFocus={(e) => e.currentTarget.select()} />
            <div className="ai-row"><Button variant="primary" icon={copied ? "check" : "copy"} onClick={() => void copy()}>{copied ? "Copied" : "Copy the prompt"}</Button><span className="ai-note">Paste it into the AI of your choice.</span></div>
          </div>
        </div>
      )}
      {step === 2 && (
        <div className="ai-col">
          <span className="ai-cap">The AI's answer</span>
          <TextArea className="ai-answer" value={answer} invalid={!!error} placeholder="[ … ]" spellcheck={false} onInput={(e) => setAnswer(e.currentTarget.value)} />
          <div className="ai-row">{error ? <span className="ai-bad"><Icon name="warning" size={12} /> {error}</span> : items.length > 0 && <span className="ai-note">{good.length} changed{bad.length > 0 && `, ${bad.length} cannot be used`}{same.length > 0 && `, ${same.length} unchanged`}</span>}</div>
        </div>
      )}
      {step === 3 && (
        <div className="ai-review">
          <p className="ai-summary"><strong>Changing naming patterns.</strong> {good.length} changed, {Object.keys(patterns).length - good.length} untouched. Files that exist keep their names. Untick what you do not want.</p>
          {good.length > 0 && <><h3>Changed · now and after</h3>{good.map((i) => row(i, true))}</>}
          {bad.length > 0 && <><h3>Cannot be used</h3>{bad.map((i) => row(i, false))}</>}
          {(same.length > 0 || stray.length > 0) && <><h3>Left out</h3><ul className="ai-problems ai-problems--quiet">{same.map((i) => <li key={i.key}>{kindOf(i.type).plural}: nothing would change.</li>)}{stray.map((m) => <li key={m}>{m}</li>)}</ul></>}
        </div>
      )}
    </Dialog>
  );
}
