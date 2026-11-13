// Port of components/navigation/navigation.card.html.
import { Breadcrumb, LoadMore, Pagination, SidebarNav, TabBar, Tree } from "@openclapper/design";
import { useState } from "preact/hooks";
import { L, Pair } from "../../kit";

function Demo() {
  const [t, setT] = useState("a");
  const [nav, setNav] = useState("scouting");
  const [sel, setSel] = useState("d2");
  const [p, setP] = useState(3);
  return (
    <div>
      <L>tab bar</L>
      <TabBar style={{ marginBottom: 10, border: "1px solid var(--border-divider)" }} value={t} onChange={setT} tabs={[{ id: "a", label: "Overview" }, { id: "b", label: "Ref_04.jpg", icon: "image", closable: true }, { id: "c", label: "History" }]} />
      <div style={{ display: "grid", gridTemplateColumns: "156px minmax(0,1fr)", gap: 12 }}>
        <SidebarNav value={nav} onChange={setNav} sections={[{ label: "Places", items: [{ id: "recent", label: "Recent", icon: "clock" }, { id: "scouting", label: "Scouting", icon: "folder", count: 24 }, { id: "photos", label: "Photos", icon: "image", count: 312 }] }, { label: "Other", items: [{ id: "bin", label: "Recycle bin", icon: "trash", count: 3 }] }]} />
        <div>
          <L>breadcrumb</L>
          <Breadcrumb items={[{ id: "p", label: "Harbour film" }, { id: "s", label: "Scouting" }, { id: "d", label: "Day 2" }]} />
          <L>tree</L>
          <Tree selected={sel} onSelect={setSel} defaultExpanded={["s"]} nodes={[{ id: "s", label: "Scouting", icon: "folder", children: [{ id: "d1", label: "Day 1", icon: "folder", children: [{ id: "x", label: "x", icon: "image" }] }, { id: "d2", label: "Day 2", icon: "folder" }, { id: "n", label: "Notes.md", icon: "file" }] }]} />
          <L>pagination · load more</L>
          <div className="r" style={{ justifyContent: "space-between", minWidth: 0 }}><Pagination page={p} pageCount={12} onChange={setP} /><LoadMore shown={50} total={312} /></div>
        </div>
      </div>
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
