// Port of guidelines/surfaces.card.html.
import { Pair } from "../../kit";

const TOKENS = ["bg-desktop", "surface", "surface-sunken", "surface-raised", "surface-bar", "surface-hover", "surface-pressed", "field"];

function Demo() {
  return (
    <div className="sw" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
      {TOKENS.map((t) => <div key={t}><i style={{ background: `var(--${t})` }} /><b>{t}</b></div>)}
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
