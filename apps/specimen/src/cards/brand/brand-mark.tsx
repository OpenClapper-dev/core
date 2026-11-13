// Port of guidelines/brand-mark.card.html.
import mark from "@openclapper/design/assets/marks/mark-production.svg";
import { Pair } from "../../kit";

const word = { font: "700 26px/1 var(--font-sans)", letterSpacing: "-.01em" };
const rd = { display: "block", borderRadius: "22%" };

function Demo() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 18, alignItems: "center" }}>
      <img style={rd} src={mark} width={128} height={128} alt="OpenClapper mark" />
      <div style={{ display: "grid", gap: 14 }}>
        <span style={{ ...word, display: "flex", alignItems: "center", gap: 10 }}><img style={rd} src={mark} width={36} height={36} alt="" />OpenClapper</span>
        <span style={word}>OpenClapper</span>
        <span className="oc-meta">Lock-up · wordmark</span>
      </div>
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
