// Port of components/actions/actions.card.html.
import { Button, Link } from "@openclapper/design";
import { L, Pair } from "../../kit";

function Demo() {
  return (
    <div>
      <L>variants</L>
      <div className="r"><Button>Secondary</Button><Button variant="primary" icon="plus">Primary</Button><Button variant="quiet">Quiet</Button><Button variant="danger" icon="trash">Delete</Button></div>
      <L>hover · focus · pressed · selected</L>
      <div className="r"><Button className="is-hover">Hover</Button><Button className="is-focus">Focus</Button><Button className="is-pressed">Pressed</Button><Button selected icon="grid">Selected</Button></div>
      <L>loading · disabled</L>
      <div className="r"><Button variant="primary" loading>Saving</Button><Button disabled>Disabled</Button><Button variant="primary" disabled>Disabled</Button></div>
      <L>icon-only · sizes 24, 28, 36</L>
      <div className="r"><Button variant="quiet" icon="grid" label="Grid" /><Button icon="more" label="More" /><Button size="sm">Small</Button><Button>Medium</Button><Button size="lg">Large</Button></div>
      <L>link</L>
      <div className="r" style={{ gap: 14 }}><Link href="#">Link</Link><Link href="#" className="is-hover">Hover</Link><Link href="#" external>External</Link><Link disabled>Disabled</Link></div>
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
