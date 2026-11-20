// UX workshop U1: editing the property catalogue with an AI. Three steps: ask (a prompt is built from the request and
// the project's current properties), paste the answer, review. Two modes with two reviews: "Add" shows each new
// property as the input it will be; "Change and add" also shows every changed property as now / after, with what
// the change costs. Nothing is applied before the review is confirmed.
import { useState } from "preact/hooks";
import { Badge, Button, Checkbox, Dialog, Icon, Segmented, TextArea, cx } from "@openclapper/design";
import { FILES, TYPES, type FieldType, type FileType } from "./data";
import { FIELD, FieldPreview, OnIcons, type Def } from "./catalogue";

type Mode = "add" | "change";
interface Entry { remove?: boolean; id?: string; name?: string; type?: string; options?: string[]; on?: string[]; section?: string; target?: string; many?: boolean }
interface Item { key: string; kind: "new" | "changed" | "removed"; before?: Def; after: Def; changes: Change[]; problems: string[] }
interface Change { what: string; from?: string; to?: string; added?: string[]; removed?: string[]; cost?: string }

const ON: FileType[] = ["shot", "photo", "canvas", "set", "location", "collection", "timeline"];
const slim = (d: Def) => ({ id: d.id, name: d.name, type: d.type, ...(d.options ? { options: d.options.map((o) => o.value) } : {}), ...(d.type === "reference" ? { target: d.target, many: !!d.many } : {}), on: d.on, ...(d.section ? { section: d.section } : {}) });

/** The prompt handed to the AI: the task for the chosen mode, the user's request, the catalogue as it is, the answer format. */
export function buildPrompt(mode: Mode, request: string, defs: Def[]): string {
  const sections = [...new Set(defs.map((d) => d.section).filter(Boolean))];
  return `You are helping to set up the properties of a film project in OpenClapper.
Properties are the metadata fields on the project's files: shots, photos, canvases, sets, locations and others.

TASK
${mode === "add"
    ? "Add new properties only. Do not change, rename or repeat a property that already exists."
    : "Change existing properties where the request asks for it, and add new ones where needed.\nFor a property you change, keep its \"id\" exactly and give the whole property as it should be afterwards.\nLeave out properties you do not touch.\nRemove a property only when the request clearly asks for it, with an entry { \"id\": \"…\", \"remove\": true }."}

REQUEST
${request.trim() || "(write here what you need)"}

THE PROJECT'S PROPERTIES NOW
${JSON.stringify(defs.map(slim), null, 1)}

ANSWER FORMAT
Answer with one JSON array and nothing else: no explanation, no code fence. Each entry is an object:
- "id": only for a property you change; copied from the list above. New properties have no "id".
- "name": short, it is used as a column heading.
- "type": one of "text", "long" (several lines), "number", "yesno", "choice" (one of the options), "multi" (several of the options), "date", "reference" (points at files), "position" (a place on the map).
- "options": for "choice" and "multi" only. 2 to 12 strings without duplicates, in the order they should appear.
- "target" and "many": for "reference" only. "target" is one of "set", "location", "shot", "photo", "canvas"; "many" is true when it can hold several.
- "on": the file types that carry the property, from "shot", "photo", "canvas", "set", "location", "collection", "timeline".
- "section": optional heading that groups properties. Reuse one of these where it fits: ${sections.length ? sections.map((s) => `"${s}"`).join(", ") : "(none yet)"}.

EXAMPLE OF THE FORM (not of the content)
[ { "name": "Permit needed", "type": "yesno", "on": ["location"] } ]`;
}

const SAMPLE: Record<Mode, string> = {
  add: `[
 { "name": "Cast", "type": "multi", "options": ["Joe", "Mara", "Conductor"], "on": ["shot"], "section": "Script" },
 { "name": "Page count", "type": "number", "on": ["shot"], "section": "Script" },
 { "name": "Permit needed", "type": "yesno", "on": ["location"] }
]`,
  change: `[
 { "id": "status", "name": "Status", "type": "choice", "options": ["Planned", "Approved", "On hold"], "on": ["shot", "photo", "canvas", "set"], "section": "This project" },
 { "id": "lens", "name": "Focal length", "type": "number", "on": ["shot"], "section": "Camera" },
 { "name": "Cast", "type": "multi", "options": ["Joe", "Mara", "Conductor"], "on": ["shot"], "section": "Script" },
 { "id": "angle", "remove": true }
]`,
};

const uses = (id: string, value?: string) => FILES.filter((f) => !f.binned && (value == null ? f.props[id] != null && f.props[id] !== "" : (Array.isArray(f.props[id]) ? (f.props[id] as string[]).includes(value) : f.props[id] === value))).length;
const names = (t: string[]) => t.map((x) => TYPES[x as FileType]?.plural ?? x);

/** Turn the pasted answer into reviewable items; anything unreadable becomes a problem on its item, or a message. */
function read(answer: string, mode: Mode, defs: Def[]): { items: Item[]; error: string } {
  const body = answer.trim().replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  if (!body) return { items: [], error: "" };
  let list: Entry[];
  try { const j = JSON.parse(body); if (!Array.isArray(j)) return { items: [], error: "The answer is not a list. It has to start with [ and end with ]." }; list = j; } catch (e) { return { items: [], error: `The answer cannot be read as JSON: ${(e as Error).message}` }; }
  const items = list.map((e, i): Item => {
    const before = e.id ? defs.find((d) => d.id === e.id) : undefined;
    if (e.remove) {
      const gone: string[] = !before ? [`It asks to remove a property “${e.id ?? ""}” that does not exist.`] : mode === "add" ? ["It removes a property, but only adding was asked for."] : [];
      const n = before ? uses(before.id) : 0;
      return { key: `${i}`, kind: "removed", before, after: before ?? { id: `x-${i}`, name: e.id ?? "Unknown", type: "text", on: [] }, changes: [{ what: "Removed", cost: n ? `${n} ${n === 1 ? "file has" : "files have"} a value. The property goes to the bin with its values; restoring it brings both back.` : "No file has a value. The property goes to the bin and can be restored." }], problems: gone };
    }
    const problems: string[] = [];
    if (!e.name || typeof e.name !== "string") problems.push("It has no name.");
    if (!e.type || !(e.type in FIELD)) problems.push(`“${e.type ?? ""}” is not a field type.`);
    if ((e.type === "choice" || e.type === "multi") && !(Array.isArray(e.options) && e.options.length >= 2)) problems.push("A choice needs at least two options.");
    const badOn = (e.on ?? []).filter((t) => !ON.includes(t as FileType));
    if (badOn.length) problems.push(`Unknown file types: ${badOn.join(", ")}.`);
    if (e.id && !before) problems.push(`It refers to a property “${e.id}” that does not exist.`);
    if (before && mode === "add") problems.push("It changes an existing property, but only adding was asked for.");
    if (!before && defs.some((d) => d.name.toLowerCase() === (e.name ?? "").toLowerCase())) problems.push("A property with this name already exists.");
    const type = (e.type && e.type in FIELD ? e.type : "text") as FieldType;
    const options = type === "choice" || type === "multi" ? (e.options ?? []).map((v, n) => ({ value: String(v), color: before?.options?.find((o) => o.value === v)?.color ?? ((before?.options?.length ?? 0) + n) % 8 + 1 })) : undefined;
    const after: Def = { id: before?.id ?? `ai-${i}`, name: e.name ?? "Unnamed", type, options, on: ((e.on ?? before?.on ?? ["shot"]).filter((t) => ON.includes(t as FileType))) as FileType[], section: e.section, target: (e.target as FileType) ?? before?.target, many: e.many ?? before?.many, hidden: before?.hidden, parent: before?.parent };
    const changes: Change[] = [];
    if (before) {
      if (before.name !== after.name) changes.push({ what: "Name", from: before.name, to: after.name });
      if (before.type !== after.type) changes.push({ what: "Field type", from: FIELD[before.type].label, to: FIELD[after.type].label, cost: uses(before.id) ? `${uses(before.id)} files have a value; values that do not fit the new type are cleared.` : undefined });
      const was = (before.options ?? []).map((o) => o.value), now = (after.options ?? []).map((o) => o.value);
      const added = now.filter((v) => !was.includes(v)), removed = was.filter((v) => !now.includes(v));
      if (added.length || removed.length) { const lost = removed.map((v) => [v, uses(before.id, v)] as const).filter(([, n]) => n > 0); changes.push({ what: "Options", added, removed, cost: lost.length ? lost.map(([v, n]) => `${n} ${n === 1 ? "file uses" : "files use"} “${v}” and ${n === 1 ? "loses" : "lose"} the value`).join("; ") + "." : undefined }); }
      else if (was.join("|") !== now.join("|") && now.length) changes.push({ what: "Order of options", from: was.join(", "), to: now.join(", ") });
      const onAdded = after.on.filter((t) => !before.on.includes(t)), onRemoved = before.on.filter((t) => !after.on.includes(t));
      if (onAdded.length || onRemoved.length) changes.push({ what: "On", added: names(onAdded), removed: names(onRemoved), cost: onRemoved.length ? "Its values on those files are kept but no longer shown." : undefined });
      if ((before.section ?? "") !== (after.section ?? "")) changes.push({ what: "Section", from: before.section ?? "none", to: after.section ?? "none" });
      if (!changes.length) problems.push("Nothing would change.");
    }
    return { key: `${i}`, kind: before ? "changed" : "new", before, after, changes, problems };
  });
  return { items, error: "" };
}

export default function AiEdit({ defs, onApply, onClose, say }: { defs: Def[]; onApply: (next: Def[], summary: string) => void; onClose: () => void; say: (m: string) => void }) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<Mode>("add");
  const [request, setRequest] = useState("");
  const [answer, setAnswer] = useState("");
  const [skip, setSkip] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const prompt = buildPrompt(mode, request, defs);
  const { items, error } = read(answer, mode, defs);
  const good = items.filter((i) => !i.problems.length), bad = items.filter((i) => i.problems.length);
  const take = good.filter((i) => !skip.includes(i.key));
  const changed = good.filter((i) => i.kind === "changed"), fresh = good.filter((i) => i.kind === "new"), removed = good.filter((i) => i.kind === "removed");
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { const el = document.querySelector<HTMLTextAreaElement>(".u1a-prompt"); el?.focus(); el?.select(); say("The browser did not allow copying: the prompt is selected, press Ctrl+C"); }
  };
  const apply = () => {
    const stamp = Date.now();
    const gone = take.filter((i) => i.kind === "removed").map((i) => i.after.id);
    const next = defs.filter((d) => !gone.includes(d.id)).map((d) => take.find((i) => i.kind === "changed" && i.after.id === d.id)?.after ?? d).concat(take.filter((i) => i.kind === "new").map((i, n) => ({ ...i.after, id: `ai${stamp}${n}` })));
    const c = take.filter((i) => i.kind === "changed").length, n = take.filter((i) => i.kind === "new").length;
    onApply(next, [n && `${n} added`, c && `${c} changed`, gone.length && `${gone.length} removed`].filter(Boolean).join(", "));
  };
  const toggle = (key: string) => setSkip(skip.includes(key) ? skip.filter((k) => k !== key) : [...skip, key]);

  const card = (i: Item) => (
    <article key={i.key} className={cx("u1a-card", skip.includes(i.key) && "is-skipped")}>
      <header><Checkbox checked={!skip.includes(i.key)} onChange={() => toggle(i.key)}>{i.kind === "new" ? "Add" : i.kind === "removed" ? "Remove" : "Apply"}</Checkbox><strong>{i.after.name}</strong><span className="u1a-card__type"><Icon name={FIELD[i.after.type].icon} size={12} /> {FIELD[i.after.type].label}</span><span style={{ flex: 1 }} />{i.after.section && <Badge>{i.after.section}</Badge>}<OnIcons on={i.after.on} /></header>
      {i.kind === "removed" ? <><div className="u1a-one"><span className="u1a-cap">Goes away</span><FieldPreview def={i.after} /></div><p className="u1a-cost"><Icon name="warning" size={12} /> {i.changes[0].cost}</p></> : i.kind === "new" ? <div className="u1a-one"><span className="u1a-cap">As it will appear</span><FieldPreview def={i.after} /></div> : (
        <>
          <div className="u1a-ab">
            <div><span className="u1a-cap">Now</span><FieldPreview def={i.before!} /></div>
            <Icon name="arrow-right" />
            <div><span className="u1a-cap">After</span><FieldPreview def={i.after} /></div>
          </div>
          <ul className="u1a-changes">
            {i.changes.map((c) => (
              <li key={c.what}>
                <span className="u1a-changes__what">{c.what}</span>
                <span>{c.from != null && <><s>{c.from}</s> <Icon name="arrow-right" size={12} /> <b>{c.to}</b></>}{c.added?.map((a) => <span key={a} className="u1a-plus">+ {a}</span>)}{c.removed?.map((r) => <span key={r} className="u1a-minus">− {r}</span>)}</span>
                {c.cost && <span className="u1a-cost"><Icon name="warning" size={12} /> {c.cost}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );

  return (
    <Dialog fixed className="u1a" title="Edit properties with AI" onClose={onClose}
      footer={<>
        <span className="u1a-steps">{["Ask", "Paste the answer", "Review"].map((s, n) => <span key={s} className={cx(step === n + 1 && "is-on", step > n + 1 && "is-done")}>{n + 1} · {s}</span>)}</span>
        <span style={{ flex: 1 }} />
        {step > 1 ? <Button onClick={() => setStep(step - 1)}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
        {step === 1 && <Button variant="primary" onClick={() => setStep(2)}>Next: paste the answer</Button>}
        {step === 2 && <Button variant="primary" disabled={!good.length} onClick={() => { setSkip(removed.map((i) => i.key)); setStep(3); }}>Next: review</Button>}
        {step === 3 && <Button variant="primary" disabled={!take.length} onClick={apply}>{take.length ? `Apply ${take.length} ${take.length === 1 ? "property" : "properties"}` : "Nothing to apply"}</Button>}
      </>}>
      {step === 1 && (
        <div className="u1a-grid">
          <div className="u1a-col">
            <span className="u1a-cap">What should the AI do?</span>
            <Segmented label="Mode" value={mode} onChange={(v) => { setMode(v as Mode); setAnswer(""); }} options={[{ value: "add", label: "Add properties" }, { value: "change", label: "Change and add" }]} />
            <p className="u1a-note">{mode === "add" ? "Only new properties come in. Existing ones stay as they are." : "Existing properties may be renamed, retyped, re-attached or get other options, and new ones may come in. The AI may also propose removing one; a removal is never ticked for you. You see every change before it happens."}</p>
            <span className="u1a-cap">What do you need?</span>
            <TextArea rows={7} value={request} placeholder={mode === "add" ? "For example: fields for cast and page count on shots, and whether a location needs a permit." : "For example: status should also have “On hold” and apply to sets; the lens should be a number."} onInput={(e) => setRequest((e.target as HTMLTextAreaElement).value)} />
            <p className="u1a-note">Your words are put into the prompt on the right, together with the project's {defs.length} properties, so the AI knows what exists.</p>
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
            <Button size="sm" variant="quiet" onClick={() => setAnswer(SAMPLE[mode])}>Use a sample answer</Button>
            {error ? <span className="u1a-bad"><Icon name="warning" size={12} /> {error}</span> : items.length > 0 && <span className="u1a-note">{fresh.length} new{mode === "change" && `, ${changed.length} changed, ${removed.length} to remove`}{bad.length > 0 && `, ${bad.length} cannot be used`}</span>}
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="u1a-review">
          <p className="u1a-summary"><strong>{mode === "add" ? "Adding" : "Changing and adding"}.</strong> {fresh.length} new{mode === "change" && <>, {changed.length} changed, {removed.length} to remove, {defs.length - changed.length - removed.length} untouched</>}. Untick what you do not want.</p>
          {changed.length > 0 && <><h3>Changed · now and after</h3>{changed.map(card)}</>}
          {fresh.length > 0 && <><h3>New</h3>{fresh.map(card)}</>}
          {removed.length > 0 && <><h3>Removal proposed · not ticked; tick to remove</h3>{removed.map(card)}</>}
          {bad.length > 0 && <><h3>Cannot be used</h3>{bad.map((i) => <article key={i.key} className="u1a-card is-bad"><header><Icon name="warning" /><strong>{i.after.name}</strong></header><ul className="u1a-problems">{i.problems.map((p) => <li key={p}>{p}</li>)}</ul></article>)}</>}
        </div>
      )}
    </Dialog>
  );
}
