// Port of components/forms/forms.card.html.
import { Checkbox, Chip, Combobox, NumberInput, PasswordInput, Radio, SearchInput, Segmented, Select, Slider, Switch, TextArea, TextInput } from "@openclapper/design";
import { useState } from "preact/hooks";
import { L, Pair } from "../../kit";

const OPTS = [{ value: "ff", label: "Full frame" }, { value: "s35", label: "Super 35" }, { value: "mft", label: "Four Thirds" }];

function Demo() {
  const [n, setN] = useState(24);
  const [q, setQ] = useState("");
  const [v, setV] = useState("grid");
  const [c, setC] = useState(true);
  const [s, setS] = useState(40);
  const [o, setO] = useState("s35");
  const w = { width: 132 };
  return (
    <div>
      <L>text · hover · focus · invalid · disabled</L>
      <div className="r"><TextInput placeholder="Name" style={w} /><TextInput defaultValue="Focus" className="is-focus" style={w} /><TextInput defaultValue="Scene 4/" invalid style={w} /><TextInput defaultValue="Disabled" disabled style={w} /></div>
      <L>number with unit · password · search</L>
      <div className="r"><NumberInput value={n} onChange={setN} unit="mm" min={1} style={{ width: 96 }} /><PasswordInput defaultValue="secret12" style={w} /><SearchInput value={q} onChange={setQ} kbd="Ctrl+F" style={{ width: 184 }} /></div>
      <L>select · combobox (cursor outline, chosen check)</L>
      <div className="r" style={{ alignItems: "flex-start", marginBottom: 116 }}><Select options={OPTS} value={o} onChange={setO} style={w} /><Combobox options={OPTS} value={o} onChange={setO} defaultOpen style={{ width: 150 }} /></div>
      <L>checkbox · radio · switch</L>
      <div className="r" style={{ gap: 14 }}><Checkbox checked={c} onChange={setC}>On</Checkbox><Checkbox checked={false} onChange={() => {}}>Off</Checkbox><Checkbox indeterminate checked={false} onChange={() => {}}>Mixed</Checkbox><Checkbox checked disabled onChange={() => {}}>Disabled</Checkbox></div>
      <div className="r" style={{ gap: 14 }}><Radio name={"r" + Math.random()} value="a" checked onChange={() => {}}>Fill</Radio><Radio value="b" checked={false} onChange={() => {}}>Fit</Radio><Switch checked={c} onChange={setC}>Grid</Switch><Switch checked={false} onChange={() => {}}>Off</Switch><Switch checked disabled onChange={() => {}}>Disabled</Switch></div>
      <L>segmented · chips (choice, removable)</L>
      <div className="r"><Segmented label="View" value={v} onChange={setV} options={[{ value: "grid", label: "Grid", icon: "grid" }, { value: "list", label: "List", icon: "list" }, { value: "map", label: "Map", icon: "map" }]} /></div>
      <div className="r"><Chip selected>Day</Chip><Chip>Night</Chip><Chip disabled>Dusk</Chip><Chip onRemove={() => {}} icon="tag">Exterior</Chip></div>
      <L>slider · text area</L>
      <div className="r"><Slider value={s} onChange={setS} style={{ width: 130 }} /><Slider value={60} disabled style={{ width: 90 }} /></div>
      <TextArea rows={2} placeholder="Notes" />
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
