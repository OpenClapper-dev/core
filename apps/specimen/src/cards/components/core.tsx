// Port of components/core/core.card.html.
import { Avatar, Badge, Divider, Icon, Kbd } from "@openclapper/design";
import { L, Pair } from "../../kit";

function Demo() {
  return (
    <div>
      <L>badge · tone always with an icon</L>
      <div className="r"><Badge>Draft</Badge><Badge tone="accent" icon="info">New</Badge><Badge tone="success" icon="check">Approved</Badge><Badge tone="warning" icon="warning">Unreviewed</Badge><Badge tone="danger" icon="error">Failed</Badge><Badge count>12</Badge></div>
      <L>keyboard hint · avatar</L>
      <div className="r"><Kbd keys="Ctrl+K" /><Kbd keys="Shift+Del" /><Kbd keys="F2" /><Avatar name="Ada Okafor" size="sm" /><Avatar name="Ada Okafor" /><Avatar name="Jon Park" size="lg" /></div>
      <L>icon 12, 16, 20 · divider</L>
      <div className="r"><Icon name="camera" size={12} /><Icon name="camera" /><Icon name="camera" size={20} /><Divider orientation="vertical" /><Icon name="folder" /><Icon name="pin" /><Icon name="clock" /></div>
      <Divider />
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
