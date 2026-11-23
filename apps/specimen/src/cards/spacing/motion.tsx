// Port of guidelines/motion.card.html.
const ITEMS: [title: string, meta: string][] = [
  ["dur-fast · 90 ms", "hover, press, colour, border"],
  ["ease · cubic-bezier(.2, 0, 0, 1)", "enter and state changes"],
  ["dur · 160 ms", "menus, lists, toasts, switch knob, collapse"],
  ["ease-in · cubic-bezier(.4, 0, 1, 1)", "exits"],
  ["dur-slow · 240 ms", "dialogs, windows, task view, theme crossfade"],
  ["Never moves", "focus rings, text, photos, frames, anything following a pointer"],
];

export default function Card() {
  return (
    <div className="one" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 24px", fontSize: 12 }}>
      {ITEMS.map(([title, meta]) => <div key={title}><b>{title}</b><br /><span className="oc-meta">{meta}</span></div>)}
    </div>
  );
}
