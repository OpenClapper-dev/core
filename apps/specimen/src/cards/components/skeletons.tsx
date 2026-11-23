// Port of guidelines/skeletons.card.html.
import { Skeleton } from "@openclapper/design";
import { L, Pair } from "../../kit";

const box = { border: "1px solid var(--border-divider)", borderRadius: "var(--radius-card)", padding: 12 };

function Demo() {
  return (
    <div aria-busy="true">
      <L>primitives · text, lines, heading, circle, control, block</L>
      <div className="r" style={{ alignItems: "center" }}><Skeleton variant="circle" size={24} /><Skeleton variant="text" width={90} /><Skeleton variant="control" width={72} /><Skeleton width={28} height={28} /></div>
      <Skeleton variant="heading" width="50%" /><Skeleton variant="text" lines={3} />
      <L>list rows</L>
      {[0, 1, 2].map(i => <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, height: 28 }}><Skeleton width={16} height={16} /><Skeleton variant="text" width={[120, 90, 140][i]} /><span style={{ flex: 1 }} /><Skeleton variant="text" width={36} /></div>)}
      <L>thumbnail tiles</L>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>{[0, 1, 2].map(i => <div key={i}><Skeleton variant="thumb" /><Skeleton variant="text" width="70%" /></div>)}</div>
      <L>card · inspector</L>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={box}><Skeleton variant="heading" width="60%" /><Skeleton variant="text" lines={2} /><div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}><Skeleton variant="control" width={64} /></div></div>
        <div style={box}>{[0, 1, 2].map(i => <div key={i} style={{ display: "flex", justifyContent: "space-between", height: 24, alignItems: "center" }}><Skeleton variant="text" width={64} /><Skeleton variant="text" width={44} /></div>)}</div>
      </div>
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
