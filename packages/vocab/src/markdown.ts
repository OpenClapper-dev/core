/**
 * The Markdown subset used for descriptions (shots, overlays, sketches): headings (#, ##, ###),
 * paragraphs, bullet and numbered lists, **bold**, *italic* (or _italic_), `code` and
 * [links](https://…). Nothing else is interpreted; unknown syntax stays literal text. Both clients
 * render the block tree this returns (the Studio as HTML elements, the phone as native Text),
 * so the text is stored as plain Markdown and never as HTML.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] };

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

const LINK_RE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/;

/** Inline parse: emphasis markers must hug their text (`**a**`, not `** a **`). */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const flush = () => { if (text) { out.push({ kind: "text", text }); text = ""; } };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && "*_`[]\\".includes(src[i + 1])) { text += src[i + 1]; i += 2; continue; }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) { flush(); out.push({ kind: "code", text: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (ch === "[") {
      const m = LINK_RE.exec(src.slice(i));
      if (m) { flush(); out.push({ kind: "link", href: m[2], children: parseInline(m[1]) }); i += m[0].length; continue; }
    }
    if (ch === "*" || ch === "_") {
      const double = src[i + 1] === ch;
      const marker = double ? ch + ch : ch;
      const inner = closing(src, i + marker.length, marker);
      if (inner !== null) {
        flush();
        const body = src.slice(i + marker.length, inner);
        out.push({ kind: double ? "strong" : "em", children: parseInline(body) });
        i = inner + marker.length;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

/** Index of the closing marker for emphasis opened at `start`, or null when it does not close properly. */
function closing(src: string, start: number, marker: string): number | null {
  if (start >= src.length || src[start] === " " || src[start] === marker[0]) return null;
  let j = src.indexOf(marker, start);
  while (j !== -1) {
    if (src[j - 1] !== " " && (marker.length === 2 || src[j + 1] !== marker[0])) return j;
    j = src.indexOf(marker, j + 1);
  }
  return null;
}

/** Block parse of a whole description. Blank lines separate paragraphs; list items may wrap onto indented lines. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const endPara = () => { if (para.length) { blocks.push({ kind: "paragraph", children: parseInline(para.join(" ").trim()) }); para = []; } };
  const endList = () => { if (list) { blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map((t) => parseInline(t.trim())) }); list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { endPara(); endList(); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) { endPara(); endList(); blocks.push({ kind: "heading", level: h[1].length as 1 | 2 | 3, children: parseInline(h[2].trim()) }); continue; }
    const li = /^\s{0,3}(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/.exec(line);
    if (li) {
      endPara();
      const ordered = li[2] !== undefined;
      if (list && list.ordered !== ordered) endList();
      if (!list) list = { ordered, items: [] };
      list.items.push(li[3]);
      continue;
    }
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    endList();
    para.push(line.trim());
  }
  endPara();
  endList();
  return blocks;
}

/** Plain text of inlines (for summaries and accessibility labels). */
export function inlineText(inlines: Inline[]): string {
  return inlines.map((n) => (n.kind === "text" || n.kind === "code" ? n.text : inlineText(n.children))).join("");
}

/** First line of a description as plain text, cut to `max` characters. */
export function markdownSummary(src: string | null | undefined, max = 120): string {
  if (!src) return "";
  const first = parseMarkdown(src)[0];
  const text = !first ? "" : first.kind === "list" ? first.items.map(inlineText).join(" · ") : inlineText(first.children);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
