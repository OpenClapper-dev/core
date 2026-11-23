// Port of guidelines/control-sizes.card.html.
const SIZES: [name: string, token: string, px: number][] = [
  ["control-sm", "control-h-sm", 24], ["control", "control-h", 28], ["control-lg", "control-h-lg", 36], ["touch", "touch", 48],
  ["row", "row-h", 24], ["titlebar", "titlebar-h", 28], ["toolbar", "toolbar-h", 36], ["taskbar", "taskbar-h", 32], ["statusbar", "statusbar-h", 22],
];

export default function Card() {
  return (
    <div className="one r" style={{ alignItems: "flex-end", gap: 12, margin: 0 }}>
      {SIZES.map(([name, token, px]) => (
        <span key={name} style={{ display: "grid", gap: 6 }}>
          <i style={{ display: "block", width: 56, height: `var(--${token})`, border: "1px solid var(--border-control)", borderRadius: "var(--radius-control)" }} />
          <span className="oc-num oc-meta" style={{ fontSize: 10 }}>{name}<br />{px}</span>
        </span>
      ))}
    </div>
  );
}
