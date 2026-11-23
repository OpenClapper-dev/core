// Port of components/data/data.card.html.
import { Button, EmptyState, List, ListRow, MapControl, MapPin, Table, ThumbnailTile } from "@openclapper/design";
import { useState } from "preact/hooks";
import { L, Pair } from "../../kit";

const Ph = () => <span style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg,#6a6a6a,#262626 70%)" }} />;
const ROWS = [{ id: "1", name: "IMG_0142.jpg", lens: "24", size: "4.2" }, { id: "2", name: "IMG_0143.jpg", lens: "35", size: "3.9" }, { id: "3", name: "IMG_0147.jpg", lens: "85", size: "5.1" }];
type Row = (typeof ROWS)[number];

function Demo() {
  const [sel, setSel] = useState(["2"]);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const rows = [...ROWS].sort((a, b) => (a[sort.key as keyof Row] > b[sort.key as keyof Row] ? 1 : -1) * (sort.dir === "asc" ? 1 : -1));
  return (
    <div>
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
