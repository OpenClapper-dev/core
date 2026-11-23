// Port of guidelines/z-layers.card.html.
const LAYERS: [name: string, z: number][] = [["desktop", 0], ["window", 100], ["taskbar", 500], ["launcher", 600], ["menu", 700], ["modal", 800], ["toast", 900], ["tooltip", 1000]];

export default function Card() {
  return (
    <div className="one r" style={{ gap: 6, margin: 0 }}>
      {LAYERS.map(([name, z]) => (
        <span key={name} style={{ display: "grid", gap: 2, padding: "6px 8px", border: "1px solid var(--border-control)", borderRadius: "var(--radius-control)", fontSize: 12 }}>
          <b>{name}</b><span className="oc-num oc-meta">{z}</span>
        </span>
      ))}
    </div>
  );
}
