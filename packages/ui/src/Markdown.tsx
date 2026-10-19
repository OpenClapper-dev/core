/**
 * Descriptions: a Markdown subset (packages/vocab markdown.ts) edited in a textarea with a small
 * formatting toolbar and a live preview, and rendered as plain elements. Stored as text, never HTML.
 */
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { parseMarkdown, type Block, type Inline } from "@fielder/vocab";
import { IconButton } from "./actions";
import { cx } from "./core";
import { Seg } from "./navigation";

function Inlines({ nodes }: { nodes: Inline[] }) {
  return <>{nodes.map((n, i) => {
    switch (n.kind) {
      case "text": return n.text;
      case "strong": return <strong key={i}><Inlines nodes={n.children} /></strong>;
      case "em": return <em key={i}><Inlines nodes={n.children} /></em>;
      case "code": return <code key={i}>{n.text}</code>;
      case "link": return <a key={i} href={n.href} target="_blank" rel="noreferrer noopener"><Inlines nodes={n.children} /></a>;
    }
  })}</>;
}

function BlockView({ b }: { b: Block }) {
  if (b.kind === "heading") { const H = `h${b.level + 1}` as "h2" | "h3" | "h4"; return <H class={`md__h md__h${b.level}`}><Inlines nodes={b.children} /></H>; }
  if (b.kind === "list") { const L = b.ordered ? "ol" : "ul"; return <L>{b.items.map((it, i) => <li key={i}><Inlines nodes={it} /></li>)}</L>; }
  return <p><Inlines nodes={b.children} /></p>;
}

/** Rendered description. `empty` shows when there is nothing to render. */
export function MarkdownView({ source, empty, class: extra }: { source: string | null | undefined; empty?: ComponentChildren; class?: string }) {
  const blocks = source ? parseMarkdown(source) : [];
  if (!blocks.length) return empty ? <div class={cx("md md--empty", extra)}>{empty}</div> : null;
  return <div class={cx("md", extra)}>{blocks.map((b, i) => <BlockView key={i} b={b} />)}</div>;
}

type Wrap = { before: string; after: string; placeholder: string } | { linePrefix: string };
const ACTIONS: { icon: string; title: string; wrap: Wrap }[] = [
  { icon: "format-bold", title: "Bold (**text**)", wrap: { before: "**", after: "**", placeholder: "bold" } },
  { icon: "format-italic", title: "Italic (*text*)", wrap: { before: "*", after: "*", placeholder: "italic" } },
  { icon: "format-header-2", title: "Heading (## )", wrap: { linePrefix: "## " } },
  { icon: "format-list-bulleted", title: "Bullet list (- )", wrap: { linePrefix: "- " } },
  { icon: "format-list-numbered", title: "Numbered list (1. )", wrap: { linePrefix: "1. " } },
  { icon: "link-variant", title: "Link ([text](https://…))", wrap: { before: "[", after: "](https://)", placeholder: "text" } },
  { icon: "code-tags", title: "Code (`text`)", wrap: { before: "`", after: "`", placeholder: "code" } },
];

/** Insert a wrap or a line prefix at the selection and return the new text plus caret range. */
function apply(text: string, start: number, end: number, w: Wrap): { text: string; start: number; end: number } {
  if ("linePrefix" in w) {
    const ls = text.lastIndexOf("\n", start - 1) + 1;
    const le = text.indexOf("\n", end); const lineEnd = le === -1 ? text.length : le;
    const lines = text.slice(ls, lineEnd).split("\n");
    const all = lines.every((l) => l.startsWith(w.linePrefix));
    const out = lines.map((l) => (all ? l.slice(w.linePrefix.length) : w.linePrefix + l)).join("\n");
    return { text: text.slice(0, ls) + out + text.slice(lineEnd), start: ls, end: ls + out.length };
  }
  const sel = text.slice(start, end) || w.placeholder;
  const out = text.slice(0, start) + w.before + sel + w.after + text.slice(end);
  return { text: out, start: start + w.before.length, end: start + w.before.length + sel.length };
}

/**
 * Textarea with a formatting toolbar (B, I, heading, lists, link, code), a Write · Preview switch
 * and the rendered preview. `onChange` fires on every edit; `onBlur` is where callers save.
 */
export function MarkdownField({ value, onChange, onBlur, placeholder, rows = 6, id, label }: { value: string; onChange: (v: string) => void; onBlur?: () => void; placeholder?: string; rows?: number; id?: string; label?: string }) {
  const [view, setView] = useState<"write" | "preview">("write");
  const ta = useRef<HTMLTextAreaElement>(null);
  const pending = useRef<{ start: number; end: number } | null>(null);
  useEffect(() => { if (pending.current && ta.current) { ta.current.focus(); ta.current.setSelectionRange(pending.current.start, pending.current.end); pending.current = null; } }, [value]);
  const run = (w: Wrap) => {
    const el = ta.current;
    const r = apply(value, el?.selectionStart ?? value.length, el?.selectionEnd ?? value.length, w);
    pending.current = { start: r.start, end: r.end };
    setView("write");
    onChange(r.text);
  };
  return (
    <div class="md-field">
      <div class="md-field__bar">
        {ACTIONS.map((a) => <IconButton key={a.icon} icon={a.icon} label={a.title} title={a.title} onClick={() => run(a.wrap)} />)}
        <span class="grow" />
        <Seg label="Description view" value={view} onChange={setView} options={[{ id: "write", label: "Write" }, { id: "preview", label: "Preview" }]} />
      </div>
      {view === "write"
        ? <textarea ref={ta} id={id} aria-label={label} class="md-field__ta" rows={rows} value={value} placeholder={placeholder} onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)} onBlur={onBlur}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); run(ACTIONS[0].wrap); } if ((e.metaKey || e.ctrlKey) && e.key === "i") { e.preventDefault(); run(ACTIONS[1].wrap); } }} />
        : <MarkdownView source={value} class="md-field__preview" empty={<span class="meta">Nothing to preview</span>} />}
    </div>
  );
}
