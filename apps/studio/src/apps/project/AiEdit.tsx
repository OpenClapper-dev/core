// Editing the property catalogue with an AI (UX workshop U1, round 7; docs/features/properties.md). Three
// steps: ask (a prompt is built from the request and the project's properties), paste the answer, review.
// "Add" shows each new property as the input it will be; "Change and add" also shows every changed one as
// now and after with what the change costs, and a proposed removal is never ticked. Nothing is saved
// before "Apply".
import { useState } from "preact/hooks";
import { Badge, Button, Checkbox, Dialog, Icon, Segmented, TextArea, cx } from "@openclapper/design";
import { FIELD_TYPES, isChoice, optionId, type FieldType, type PropertyDef } from "@openclapper/model";
import type { FileRec } from "../../api";
import { kindOf } from "../../fileKinds";
import { bin, loadRoot } from "../../files";
import { toast, toastError } from "../../hosts";
import { createDefinition, PROPERTY_TYPES, saveDefinition, type Definition } from "../../props";
import { FieldPreview, FIELD_ICON, fieldLabel, OnIcons } from "./parts";
import { usesOf } from "./Properties";

type Mode = "add" | "change";
interface Entry { remove?: boolean; id?: string; name?: string; type?: string; options?: unknown[]; on?: string[]; section?: string; target?: string; many?: boolean }
interface Change { what: string; from?: string; to?: string; added?: string[]; removed?: string[]; cost?: string }
interface Item { key: string; kind: "new" | "changed" | "removed"; before?: Definition; name: string; after: PropertyDef; changes: Change[]; problems: string[] }

const REF_TARGETS = ["set", "location", "shot", "photo", "canvas", "collection", "timeline"];
const slim = (d: Definition) => ({
  id: d.id, name: d.name, type: d.def.field,
  ...(d.def.options ? { options: d.def.options.map((o) => o.label) } : {}),
  ...(d.def.field === "reference" ? { target: d.def.targets?.[0] ?? null, many: !!d.def.many } : {}),
  on: d.def.attached.map((a) => a.type), ...(d.def.section ? { section: d.def.section } : {}),
});

/** The prompt handed to the AI: the task for the mode, the request, the catalogue as it is, the answer format. */
export function buildPrompt(mode: Mode, request: string, defs: Definition[]): string {
  const sections = [...new Set(defs.map((d) => d.def.section).filter(Boolean))];
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
- "options": for "choice" and "multi" only. 2 to 30 strings without duplicates, in the order they should appear.
- "target" and "many": for "reference" only. "target" is one of ${REF_TARGETS.map((t) => `"${t}"`).join(", ")}; "many" is true when it can hold several.
- "on": the file types that carry the property, from ${PROPERTY_TYPES.map((t) => `"${t}"`).join(", ")}.
- "section": optional heading that groups properties. Reuse one of these where it fits: ${sections.length ? sections.map((s) => `"${s}"`).join(", ") : "(none yet)"}.

EXAMPLE OF THE FORM (not of the content)
[ { "name": "Permit needed", "type": "yesno", "on": ["location"] } ]`;
}

const plurals = (t: string[]) => t.map((x) => kindOf(x).plural);

/** Turns the pasted answer into reviewable items; anything unreadable becomes a problem on its item, or a message. */
function read(answer: string, mode: Mode, defs: Definition[], files: readonly FileRec[] | null): { items: Item[]; error: string } {
  const body = answer.trim().replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();
  if (!body) return { items: [], error: "" };
  let list: Entry[];
  try { const j = JSON.parse(body) as unknown; if (!Array.isArray(j)) return { items: [], error: "The answer is not a list. It has to start with [ and end with ]." }; list = j as Entry[]; }
  catch (e) { return { items: [], error: `The answer cannot be read as JSON: ${(e as Error).message}` }; }
  const items = list.map((e, i): Item => {
    if (typeof e !== "object" || e === null) return { key: `${i}`, kind: "new", name: "Unreadable", after: { field: "text", attached: [], order: 0 }, changes: [], problems: ["The entry is not an object."] };
    const before = e.id ? defs.find((d) => d.id === e.id) : undefined;
    if (e.remove) {
      const n = before ? usesOf(files, before.id) : 0;
      return {
        key: `${i}`, kind: "removed", before, name: before?.name ?? String(e.id ?? "Unknown"), after: before?.def ?? { field: "text", attached: [], order: 0 },
        changes: [{ what: "Removed", cost: n ? `${n} ${n === 1 ? "file has" : "files have"} a value. The property goes to the bin with its values; restoring it brings both back.` : "No file has a value. The property goes to the bin and can be restored." }],
        problems: !before ? [`It asks to remove a property “${e.id ?? ""}” that does not exist.`] : mode === "add" ? ["It removes a property, but only adding was asked for."] : [],
      };
    }
    const problems: string[] = [];
    const name = typeof e.name === "string" ? e.name.trim().slice(0, 120) : "";
    if (!name) problems.push("It has no name.");
    const field = (FIELD_TYPES as readonly string[]).includes(String(e.type)) ? (e.type as FieldType) : null;
    if (!field) problems.push(`“${e.type ?? ""}” is not a field type.`);
    const labels = Array.isArray(e.options) ? [...new Set(e.options.map((x) => String(x).trim().slice(0, 80)).filter(Boolean))] : [];
    if (field && isChoice(field) && labels.length < 2) problems.push("A choice needs at least two options.");
    const on = Array.isArray(e.on) ? e.on.map(String) : before?.def.attached.map((a) => a.type) ?? ["shot"];
    const badOn = on.filter((t) => !PROPERTY_TYPES.includes(t));
    if (badOn.length) problems.push(`Unknown file types: ${badOn.join(", ")}.`);
    if (e.id && !before) problems.push(`It refers to a property “${e.id}” that does not exist.`);
    if (before && mode === "add") problems.push("It changes an existing property, but only adding was asked for.");
    if (!before && defs.some((d) => d.name.toLowerCase() === name.toLowerCase())) problems.push("A property with this name already exists.");
    const f = field ?? "text";
    const after: PropertyDef = { field: f, attached: on.filter((t) => PROPERTY_TYPES.includes(t)).map((t) => ({ type: t, ...(before?.def.attached.find((a) => a.type === t)?.hidden ? { hidden: true } : {}) })), order: before?.def.order ?? 0 };
    if (typeof e.section === "string" && e.section.trim()) after.section = e.section.trim().slice(0, 60);
    if (isChoice(f)) {
      const ids: string[] = [];
      after.options = labels.map((label, n) => {
        const was = before?.def.options?.find((o) => o.label.toLowerCase() === label.toLowerCase());
        const id = was?.id ?? optionId(label, [...ids, ...(before?.def.options ?? []).map((o) => o.id)]);
        ids.push(id);
        return { id, label, color: was?.color ?? (((before?.def.options?.length ?? 0) + n) % 8) + 1 };
      });
      if (f === "choice" && before?.def.dependsOn) after.dependsOn = { ...before.def.dependsOn, map: Object.fromEntries(Object.entries(before.def.dependsOn.map).map(([k, v]) => [k, v.filter((x) => ids.includes(x))])) };
    }
    if (f === "reference") {
      const t = typeof e.target === "string" ? e.target : before?.def.targets?.[0];
      after.targets = t && REF_TARGETS.includes(t) ? [t] : [];
      after.many = typeof e.many === "boolean" ? e.many : !!before?.def.many;
    }
    if (f === "number" && before?.def.unit) after.unit = before.def.unit;
    const changes: Change[] = [];
    if (before) {
      const n = usesOf(files, before.id);
      if (before.name !== name) changes.push({ what: "Name", from: before.name, to: name });
      if (before.def.field !== f) changes.push({ what: "Field type", from: fieldLabel(before.def.field), to: fieldLabel(f), cost: n ? `${n} files have a value; values that do not fit the new type are cleared.` : undefined });
      const was = (before.def.options ?? []).map((o) => o.label), now = (after.options ?? []).map((o) => o.label);
      const added = now.filter((v) => !was.some((w) => w.toLowerCase() === v.toLowerCase())), removed = was.filter((v) => !now.some((w) => w.toLowerCase() === v.toLowerCase()));
      if (added.length || removed.length) {
        const lost = removed.map((v) => [v, usesOf(files, before.id, before.def.options!.find((o) => o.label === v)!.id)] as const).filter(([, k]) => k > 0);
        changes.push({ what: "Options", added, removed, cost: lost.length ? `${lost.map(([v, k]) => `${k} ${k === 1 ? "file uses" : "files use"} “${v}” and ${k === 1 ? "loses" : "lose"} the value`).join("; ")}.` : undefined });
      } else if (was.join("|") !== now.join("|") && now.length) changes.push({ what: "Order of options", from: was.join(", "), to: now.join(", ") });
      const bOn = before.def.attached.map((a) => a.type), aOn = after.attached.map((a) => a.type);
      const onAdded = aOn.filter((t) => !bOn.includes(t)), onRemoved = bOn.filter((t) => !aOn.includes(t));
      if (onAdded.length || onRemoved.length) changes.push({ what: "On", added: plurals(onAdded), removed: plurals(onRemoved), cost: onRemoved.length ? "Its values on those files are kept but no longer shown." : undefined });
      if ((before.def.section ?? "") !== (after.section ?? "")) changes.push({ what: "Section", from: before.def.section ?? "none", to: after.section ?? "none" });
      if (JSON.stringify(before.def.targets ?? []) !== JSON.stringify(after.targets ?? []) || !!before.def.many !== !!after.many) if (f === "reference") changes.push({ what: "Points at", from: plurals(before.def.targets ?? []).join(", ") || "any file", to: `${plurals(after.targets ?? []).join(", ") || "any file"}${after.many ? ", several" : ""}` });
      if (!changes.length) problems.push("Nothing would change.");
    }
    return { key: `${i}`, kind: before ? "changed" : "new", before, name: name || "Unnamed", after, changes, problems };
  });
  return { items, error: "" };
}

export function AiEdit({ projectId, files, defs, onClose }: { projectId: string; files: FileRec[] | null; defs: Definition[]; onClose: () => void }) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<Mode>("add");
  const [request, setRequest] = useState("");
  const [answer, setAnswer] = useState("");
  const [skip, setSkip] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const prompt = buildPrompt(mode, request, defs);
  const { items, error } = read(answer, mode, defs, files);
  const good = items.filter((i) => !i.problems.length), bad = items.filter((i) => i.problems.length);
  const take = good.filter((i) => !skip.includes(i.key));
  const changed = good.filter((i) => i.kind === "changed"), fresh = good.filter((i) => i.kind === "new"), removed = good.filter((i) => i.kind === "removed");
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { const el = document.querySelector<HTMLTextAreaElement>(".ai-prompt"); el?.focus(); el?.select(); toast("The browser did not allow copying: the prompt is selected, press Ctrl+C", { tone: "warning" }); }
  };
  const apply = async () => {
    setBusy(true);
    let done = 0;
    try {
      let order = defs.reduce((m, d) => Math.max(m, d.def.order), -1) + 1;
      for (const i of take) {
        if (i.kind === "new") await createDefinition(projectId, files, i.name, i.after, order++);
        else if (i.kind === "changed") await saveDefinition(i.before!, { name: i.name, def: i.after });
        else await bin({ project: projectId }, [i.before!.id]);
        done++;
      }
      const c = take.filter((i) => i.kind === "changed").length, n = take.filter((i) => i.kind === "new").length, r = take.filter((i) => i.kind === "removed").length;
      toast(`Properties: ${[n && `${n} added`, c && `${c} changed`, r && `${r} removed`].filter(Boolean).join(", ")}`);
      onClose();
    } catch (e) { toastError(e); if (done) toast(`${done} of ${take.length} were applied before the error`, { tone: "warning" }); }
    finally { setBusy(false); await loadRoot({ project: projectId }); }
  };
  const toggle = (key: string) => setSkip(skip.includes(key) ? skip.filter((k) => k !== key) : [...skip, key]);

  const card = (i: Item) => (
    <article key={i.key} className={cx("ai-card", skip.includes(i.key) && "is-skipped")}>
      <header><Checkbox checked={!skip.includes(i.key)} onChange={() => toggle(i.key)}>{i.kind === "new" ? "Add" : i.kind === "removed" ? "Remove" : "Apply"}</Checkbox><strong>{i.name}</strong><span className="ai-card__type"><Icon name={FIELD_ICON[i.after.field]} size={12} /> {fieldLabel(i.after.field)}</span><span style={{ flex: 1 }} />{i.after.section && <Badge>{i.after.section}</Badge>}<OnIcons def={i.after} /></header>
      {i.kind === "removed" ? <><div className="ai-one"><span className="ai-cap">Goes away</span><FieldPreview name={i.name} def={i.after} /></div><p className="ai-cost"><Icon name="warning" size={12} /> {i.changes[0].cost}</p></>
        : i.kind === "new" ? <div className="ai-one"><span className="ai-cap">As it will appear</span><FieldPreview name={i.name} def={i.after} /></div> : (
          <>
            <div className="ai-ab">
              <div><span className="ai-cap">Now</span><FieldPreview name={i.before!.name} def={i.before!.def} /></div>
              <Icon name="arrow-right" />
              <div><span className="ai-cap">After</span><FieldPreview name={i.name} def={i.after} /></div>
            </div>
            <ul className="ai-changes">
              {i.changes.map((c) => (
                <li key={c.what}>
                  <span className="ai-changes__what">{c.what}</span>
                  <span>{c.from != null && <><s>{c.from}</s> <Icon name="arrow-right" size={12} /> <b>{c.to}</b></>}{c.added?.map((a) => <span key={a} className="ai-plus">+ {a}</span>)}{c.removed?.map((r) => <span key={r} className="ai-minus">− {r}</span>)}</span>
                  {c.cost && <span className="ai-cost"><Icon name="warning" size={12} /> {c.cost}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
    </article>
  );

  return (
    <Dialog fixed className="ai" title="Edit properties with AI" onClose={onClose}
      footer={<>
        <span className="ai-steps">{["Ask", "Paste the answer", "Review"].map((s, n) => <span key={s} className={cx(step === n + 1 && "is-on", step > n + 1 && "is-done")}>{n + 1} · {s}</span>)}</span>
        <span style={{ flex: 1 }} />
        {step > 1 ? <Button onClick={() => setStep(step - 1)}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
        {step === 1 && <Button variant="primary" onClick={() => setStep(2)}>Next: paste the answer</Button>}
        {step === 2 && <Button variant="primary" disabled={!good.length} onClick={() => { setSkip(removed.map((i) => i.key)); setStep(3); }}>Next: review</Button>}
        {step === 3 && <Button variant="primary" disabled={!take.length || busy} onClick={() => void apply()}>{take.length ? `Apply ${take.length} ${take.length === 1 ? "property" : "properties"}` : "Nothing to apply"}</Button>}
      </>}>
      {step === 1 && (
        <div className="ai-grid">
          <div className="ai-col">
            <span className="ai-cap">What should the AI do?</span>
            <Segmented label="Mode" value={mode} onChange={(v) => { setMode(v as Mode); setAnswer(""); }} options={[{ value: "add", label: "Add properties" }, { value: "change", label: "Change and add" }]} />
            <p className="ai-note">{mode === "add" ? "Only new properties come in. Existing ones stay as they are." : "Existing properties may be renamed, retyped, re-attached or get other options, and new ones may come in. The AI may also propose removing one; a removal is never ticked for you. You see every change before it happens."}</p>
            <span className="ai-cap">What do you need?</span>
            <TextArea rows={7} value={request} placeholder={mode === "add" ? "For example: fields for cast and page count on shots, and whether a location needs a permit." : "For example: shot size should also have “Insert”; the lens should be a number."} onInput={(e) => setRequest(e.currentTarget.value)} />
            <p className="ai-note">Your words are put into the prompt on the right, together with the project's {defs.length} properties, so the AI knows what exists.</p>
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
          <div className="ai-row">
            {error ? <span className="ai-bad"><Icon name="warning" size={12} /> {error}</span> : items.length > 0 && <span className="ai-note">{fresh.length} new{mode === "change" && `, ${changed.length} changed, ${removed.length} to remove`}{bad.length > 0 && `, ${bad.length} cannot be used`}</span>}
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="ai-review">
          <p className="ai-summary"><strong>{mode === "add" ? "Adding" : "Changing and adding"}.</strong> {fresh.length} new{mode === "change" && <>, {changed.length} changed, {removed.length} to remove, {defs.length - changed.length - removed.length} untouched</>}. Untick what you do not want.</p>
          {changed.length > 0 && <><h3>Changed · now and after</h3>{changed.map(card)}</>}
          {fresh.length > 0 && <><h3>New</h3>{fresh.map(card)}</>}
          {removed.length > 0 && <><h3>Removal proposed · not ticked; tick to remove</h3>{removed.map(card)}</>}
          {bad.length > 0 && <><h3>Cannot be used</h3>{bad.map((i) => <article key={i.key} className="ai-card is-bad"><header><Icon name="warning" /><strong>{i.name}</strong></header><ul className="ai-problems">{i.problems.map((p) => <li key={p}>{p}</li>)}</ul></article>)}</>}
        </div>
      )}
    </Dialog>
  );
}
