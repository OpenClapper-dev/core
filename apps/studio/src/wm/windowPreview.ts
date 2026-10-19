/**
 * Pictures of windows for the task view (issue #153). Every window stays mounted (hidden with
 * `display: none` when away or minimised), so its content can be copied: a deep clone, cleaned of
 * what must stay unique in the document, laid out at the window's own size and scaled down by the
 * caller. A snapshot, not live: nothing in the windows changes while the task view is open.
 */

/** Attributes that are looked up document-wide or would tie the copy to the original. */
const STRIP = ["id", "data-overlay", "data-icon-id", "data-win-id", "autofocus", "for", "aria-controls", "aria-labelledby", "aria-describedby", "aria-activedescendant", "tabindex"];

/** The content element of a window, or null when it is not in the document. */
export const contentOf = (winId: string) => document.querySelector<HTMLElement>(`.wm-window[data-win-id="${CSS.escape(winId)}"] > .wm-window__content`);

/**
 * The size the window's content has, or would have if shown: measured when it is on screen,
 * otherwise its frame minus the title bar and the borders.
 */
export function contentSize(content: HTMLElement, frame: { w: number; h: number }): { w: number; h: number } | null {
  if (content.clientWidth > 0 && content.clientHeight > 0) return { w: content.clientWidth, h: content.clientHeight };
  const win = content.parentElement!;
  const bar = win.querySelector<HTMLElement>(".wm-window__bar");
  const border = parseFloat(getComputedStyle(win).borderTopWidth) || 0;
  const barH = parseFloat(bar ? getComputedStyle(bar).height : "") || 36;
  const w = Math.round(frame.w - 2 * border), h = Math.round(frame.h - barH - 2 * border);
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * A deep copy of a window's content that cannot clash with the original. Radio `name`s go before
 * the copy is inserted (a checked copy would uncheck the original's group); typed values are
 * properties, not attributes, so they are carried over by hand.
 */
export function snapshot(content: HTMLElement): HTMLElement {
  const copy = content.cloneNode(true) as HTMLElement;
  const from = content.querySelectorAll<HTMLElement>("input, textarea, select");
  const to = copy.querySelectorAll<HTMLElement>("input, textarea, select");
  to.forEach((el, i) => {
    const src = from[i] as HTMLInputElement;
    el.removeAttribute("name");
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) el.checked = src.checked;
    else if (!(el instanceof HTMLInputElement && el.type === "file")) (el as HTMLInputElement).value = src.value;
  });
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) for (const a of STRIP) el.removeAttribute(a);
  copy.querySelectorAll("video, audio").forEach((m) => (m as HTMLMediaElement).removeAttribute("autoplay"));
  return copy;
}
