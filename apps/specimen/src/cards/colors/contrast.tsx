// Port of guidelines/contrast.card.html: every pair's ratio is computed live from the tokens as resolved in each half.
import { useLayoutEffect, useRef, useState } from "preact/hooks";

/** [foreground token, background token, minimum ratio]; 0 = decorative, no minimum. */
const PAIRS: [string, string, number][] = [
  ["text", "surface", 7], ["text", "surface-sunken", 7], ["text", "surface-bar", 7], ["text", "surface-hover", 7], ["text", "selection", 7], ["text", "field", 7],
  ["text-on-accent", "accent", 7], ["text-inverse", "surface-inverse", 7],
  ["accent", "surface", 4.5], ["danger", "surface", 4.5], ["success", "surface", 4.5], ["warning", "surface", 4.5],
  ["text-secondary", "surface", 4.5], ["text-secondary", "surface-sunken", 4.5], ["text-secondary", "surface-bar", 4.5],
  ["border-control", "surface", 3], ["border-control", "surface-sunken", 3], ["border-control", "field", 3],
  ["focus", "surface", 3], ["selection-border", "selection", 3], ["border-window-focused", "bg-desktop", 3],
  ["border-window", "bg-desktop", 0], ["border-divider", "surface", 0],
  ["cat-1", "surface", 3], ["cat-2", "surface", 3], ["cat-3", "surface", 3], ["cat-4", "surface", 3], ["cat-5", "surface", 3], ["cat-6", "surface", 3], ["cat-7", "surface", 3], ["cat-8", "surface", 3],
];

/** Resolves a token to sRGB channels by letting the browser compute it inside `el`, so the theme of that subtree applies. */
function rgb(el: HTMLElement, token: string): number[] {
  const probe = document.createElement("i");
  probe.style.color = `var(--${token})`;
  el.appendChild(probe);
  const m = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(Number);
  probe.remove();
  return m;
}

/** WCAG relative luminance. */
function lum(c: number[]): number {
  const [r, g, b] = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function Table({ theme }: { theme: "light" | "dark" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ratios, setRatios] = useState<number[] | null>(null);
  useLayoutEffect(() => {
    let live = true;
    const fill = () => {
      const el = ref.current;
      if (!el || !live) return;
      setRatios(PAIRS.map(([a, b]) => { const x = lum(rgb(el, a)), y = lum(rgb(el, b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }));
    };
    fill();
    void document.fonts.ready.then(fill);
    return () => { live = false; };
  }, []);
  return (
    <div className="half" data-theme={theme} ref={ref}>
      <table style={{ fontSize: 10 }}>
        <tbody>
          <tr><th>foreground / background</th><th>ratio</th><th>min</th><th /></tr>
          {ratios && PAIRS.map(([a, b, m], i) => {
            const r = ratios[i];
            return (
              <tr key={`${a}/${b}`}>
                <td>{a} / {b}</td><td>{r.toFixed(1)}:1</td>
                {m === 0
                  ? <><td>none</td><td style={{ color: "var(--text-secondary)" }}>decorative</td></>
                  : <><td>{m}</td><td style={{ fontWeight: 700, color: `var(--${r >= m ? "success" : "danger"})` }}>{r >= m ? "pass" : "FAIL"}</td></>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Card() {
  return <div className="pair"><Table theme="light" /><Table theme="dark" /></div>;
}
