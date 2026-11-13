// Port of components/feedback/feedback.card.html.
import { Button, ProgressBar, Skeleton, Spinner, Tooltip } from "@openclapper/design";
import { L, Pair } from "../../kit";

function Demo() {
  return (
    <div>
      <L>tooltip with shortcut · spinner</L>
      <div className="r" style={{ marginTop: 34, gap: 60, paddingLeft: 40 }}><Tooltip label="Grid view" kbd="G" open><Button variant="quiet" icon="grid" label="Grid view" /></Tooltip><Spinner /><Spinner size={20} /></div>
      <L>progress · determinate, indeterminate</L>
      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}><ProgressBar value={62} showValue label="Upload" /><ProgressBar label="Working" /></div>
      <L>skeleton</L>
      <div className="r"><Skeleton width={48} height={32} /><div style={{ flex: 1 }}><Skeleton variant="text" width="70%" /><Skeleton variant="text" width="40%" /></div></div>
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
