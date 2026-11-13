// Port of guidelines/space-scale.card.html.
const STEPS: [step: number, px: number][] = [[1, 2], [2, 4], [3, 6], [4, 8], [5, 12], [6, 16], [7, 24], [8, 32], [9, 48]];

export default function Card() {
  return (
    <div className="one r" style={{ alignItems: "flex-end", gap: 14, margin: 0 }}>
      {STEPS.map(([step, px]) => (
        <span key={step} style={{ display: "grid", gap: 6, justifyItems: "start" }}>
          <i style={{ display: "block", width: `var(--space-${step})`, height: `var(--space-${step})`, background: "var(--accent)" }} />
          <span className="oc-num oc-meta">{step} · {px}</span>
        </span>
      ))}
    </div>
  );
}
