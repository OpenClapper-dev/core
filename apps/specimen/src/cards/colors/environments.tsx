// Port of guidelines/environments.card.html. The in-app marker is the source's inline markup (not EnvMarker).
const ENVS: [name: string, token: string][] = [["Production", "env-production"], ["Staging", "env-staging"], ["Development", "env-development"]];

export default function Card() {
  return (
    <div className="one r" style={{ gap: 20 }}>
      {ENVS.map(([name, token]) => (
        <span key={token} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <i style={{ width: 48, height: 48, borderRadius: 10, background: `var(--${token})` }} />
          <span style={{ display: "grid", gap: 5 }}>
            <span style={{ display: "inline-flex", alignItems: "center", height: 20, padding: "0 7px", borderRadius: 3, background: `var(--${token})`, color: "var(--on-env)", font: "700 11px/1 var(--font-sans)" }}>{name}</span>
            <span className="oc-num oc-meta">--{token}</span>
          </span>
        </span>
      ))}
    </div>
  );
}
