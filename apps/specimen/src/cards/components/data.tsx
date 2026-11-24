// Port of components/data/data.card.html.
import { AppIcon, BatteryBar, Button, ColorChooser, ConnectionMark, DeviceCard, Slider, Switch, CollectionTag, EmptyState, FileCard, FileGrid, List, ListRow, MapControl, MapPin, Table, ThumbnailTile, colorCss, type ChosenColor, type CollectionMark } from "@openclapper/design";
import { useState } from "preact/hooks";
import { L, Pair } from "../../kit";

const Ph = () => <span style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg,#6a6a6a,#262626 70%)" }} />;
const ROWS = [{ id: "1", name: "IMG_0142.jpg", lens: "24", size: "4.2" }, { id: "2", name: "IMG_0143.jpg", lens: "35", size: "3.9" }, { id: "3", name: "IMG_0147.jpg", lens: "85", size: "5.1" }];
type Row = (typeof ROWS)[number];

/** A picture made in the page: a gradient with a label, so the card needs no image files. */
const pic = (hue: number, label: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 38%)"/><stop offset="1" stop-color="hsl(${hue + 50} 55% 68%)"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><text x="24" y="170" font-family="sans-serif" font-size="56" fill="white">${label}</text></svg>`)}`;

/** Files with pictures: a collection as a stack that scrubs, its photos with its colour as a mark, the upload badge, and how a colour is chosen. */
function Media() {
  const [mark, setMark] = useState<CollectionMark>("bar");
  const [color, setColor] = useState<ChosenColor>(6);
  const tint = colorCss(color);
  const srcs = [pic(20, "24"), pic(120, "35"), pic(220, "50"), pic(300, "85")];
  return (
    <>
      <L>file cards · a collection is a stack: move the pointer across it to scrub · its photos carry its colour · marks: {(["bar", "barleft", "dot", "frame"] as CollectionMark[]).map((m) => <button key={m} type="button" className="oc-btn oc-btn--sm oc-btn--quiet" aria-pressed={m === mark} onClick={() => setMark(m)}>{m}</button>)}</L>
      <FileGrid style={{ marginBottom: 12, padding: 0 }}>
        <FileCard name="Morning walk" meta="4 photos" art={<img src={srcs[0]} alt="" />} picture stack={{ srcs, count: 4 }} tint={tint} mark={mark} badge={<AppIcon glyph="layers" color={4} size={20} />} />
        <FileCard name="IMG_0142" meta="Morning walk" art={<img src={srcs[1]} alt="" />} picture tint={tint} mark={mark} />
        <FileCard name="IMG_0143" meta="Preview sent" art={<img src={srcs[2]} alt="" />} picture upload="preview" />
        <FileCard name="IMG_0144" meta="Stuck" art={<img src={srcs[3]} alt="" />} picture upload="stuck" selected onTick={() => {}} />
        <FileCard name="Scouting" meta="12 items" art={<AppIcon glyph="folder" color={5} size={48} />} current />
      </FileGrid>
      <L>colour chooser · eight colours and one of your own · <CollectionTag tint={tint}>Morning walk</CollectionTag></L>
      <div style={{ maxWidth: 260, marginBottom: 12 }}><ColorChooser value={color} onChange={setColor} label="Collection colour" /></div>
    </>
  );
}

/** Devices (U6): a card across the width with what the device exposes, the coloured connection mark, the battery bar. */
function Devices() {
  const [on, setOn] = useState(true);
  const [level, setLevel] = useState(62);
  return (
    <>
      <L>device cards · connection in colour · battery as a bar</L>
      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <DeviceCard icon="light-fixture" color={3} name="Key light" sub="NEEWER FS300B" connection={<ConnectionMark tone="ok" label="Connected" />} battery={<BatteryBar charge={74} minutes={95} />}>
          <Switch checked={on} onChange={setOn}>Power</Switch>
          <label style={{ display: "grid", gap: 4, minWidth: 180 }}><small>Intensity {level} %</small><Slider value={level} min={0} max={100} onChange={setLevel} /></label>
        </DeviceCard>
        <DeviceCard icon="battery" color={4} name="V-mount 1" sub="NEEWER PS099S" connection={<ConnectionMark tone="warn" label="Reconnecting (try 2)" />} battery={<BatteryBar charge={22} minutes={31} />}>Powers Key light</DeviceCard>
        <DeviceCard icon="video" color={1} name="A camera" sub="Blackmagic Pocket 6K" off connection={<ConnectionMark tone="off" label="Asleep · not connecting" />} battery={<BatteryBar charge={null} />} />
        <DeviceCard icon="light-fixture" color={3} name="MC 2" sub="Aputure MC" connection={<ConnectionMark tone="danger" label="Cannot connect" />} battery={<BatteryBar charge={9} />} />
      </div>
    </>
  );
}

function Demo() {
  const [sel, setSel] = useState(["2"]);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const rows = [...ROWS].sort((a, b) => (a[sort.key as keyof Row] > b[sort.key as keyof Row] ? 1 : -1) * (sort.dir === "asc" ? 1 : -1));
  return (
    <div>
      <Media />
      <Devices />
      <L>list · rest, selected, cursor, chevron</L>
      <List style={{ marginBottom: 10 }}><ListRow icon="folder" meta="24">Scouting</ListRow><ListRow icon="folder" meta="18" selected>Day 2</ListRow><ListRow icon="image" meta="4.2 MB" cursor>Ref_04.jpg</ListRow><ListRow icon="user" chevron>Crew</ListRow></List>
      <L>table · sort, select, mono numbers</L>
      <div style={{ marginBottom: 10 }}><Table selectable sort={sort} onSort={setSort} selected={sel} onSelect={setSel} cursor="3" columns={[{ key: "name", label: "Name", sortable: true }, { key: "lens", label: "Lens mm", numeric: true, sortable: true }, { key: "size", label: "MB", numeric: true }]} rows={rows} /></div>
      <L>thumbnail tiles · map</L>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr) 1.4fr", gap: 8, alignItems: "start" }}>
        <ThumbnailTile name="IMG_0142.jpg" meta="24 mm · f/2.8" badges={["RAW"]}><Ph /></ThumbnailTile>
        <ThumbnailTile name="IMG_0143.jpg" meta="35 mm · f/4" selected badges={["4K", "★"]}><Ph /></ThumbnailTile>
        <ThumbnailTile name="IMG_0147.jpg" meta="85 mm · f/1.8"><Ph /></ThumbnailTile>
        <div style={{ position: "relative", height: 92, background: "#8a9a7a", overflow: "hidden" }}>
          <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(30deg,transparent 0 18px,#ffffff55 18px 20px)" }} />
          <MapPin style={{ position: "absolute", left: 22, top: 18 }}>1</MapPin><MapPin style={{ position: "absolute", left: 70, top: 8 }} selected label="Day 2">2</MapPin>
          <MapControl style={{ position: "absolute", right: 6, top: 6 }} />
        </div>
      </div>
      <L>empty state</L>
      <EmptyState icon="image" title="No photos yet" action={<Button variant="primary" size="sm" icon="upload">Import</Button>} style={{ padding: "8px 0" }}>Photos you import appear here.</EmptyState>
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
