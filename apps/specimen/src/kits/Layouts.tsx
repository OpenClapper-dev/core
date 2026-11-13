// App layout templates (export ui_kits/layouts), filled with neutral placeholders. Composes design-system parts only.
import "./kits.css";
import type { ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  AppWindow, AppIcon, Toolbar, ToolbarSpacer, StatusBar, SidebarNav, Breadcrumb, Button, SearchInput, Segmented, ThumbnailTile, PropertyList, PropertySection, PropertyRow, Table, Chip, Pagination, ToolRail, FormField, TextInput, Select, Switch, NumberInput,
  BrowserLayout, ViewerLayout, EditorLayout, TrackLayout, SettingsLayout, SettingsGroup, TableLayout,
  type IconName,
} from "@openclapper/design";

const Ph = () => <span style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg,#6a6a6a,#262626 70%)" }} />;

function BrowserSpecimen() {
  const [sel, setSel] = useState(["b"]);
  const [nav, setNav] = useState("all");
  const [view, setView] = useState("grid");
  return (
    <BrowserLayout sidebarWidth={140}
      toolbar={<Toolbar><Breadcrumb items={[{ id: "p", label: "Project" }, { id: "c", label: "Collection" }]} /><ToolbarSpacer /><Segmented value={view} onChange={setView} label="View" options={[{ value: "grid", icon: "grid", title: "Grid" }, { value: "list", icon: "list", title: "List" }]} /><Button size="sm" variant="primary" icon="plus">New</Button></Toolbar>}
      sidebar={<SidebarNav value={nav} onChange={setNav} sections={[{ items: [{ id: "all", label: "All items", icon: "files", count: 48 }, { id: "recent", label: "Recent", icon: "clock" }, { id: "starred", label: "Starred", icon: "star", count: 6 }] }, { label: "Folders", items: [{ id: "f1", label: "Folder A", icon: "folder" }, { id: "f2", label: "Folder B", icon: "folder" }] }]} />}
      statusBar={<StatusBar>48 items · <strong>{sel.length} selected</strong></StatusBar>}>
      <div style={{ padding: 8, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 10 }}>
        {["a", "b", "c", "d", "e", "f", "g", "h"].map((k, i) => <ThumbnailTile key={k} name={"Item " + (i + 1)} meta="Meta · 12" selected={sel.includes(k)} onClick={() => setSel([k])}><Ph /></ThumbnailTile>)}
      </div>
    </BrowserLayout>
  );
}

function ViewerSpecimen() {
  const [i, setI] = useState(1);
  return (
    <ViewerLayout inspectorWidth={200}
      toolbar={<Toolbar><Button variant="quiet" size="sm" icon="chevron-left" label="Previous" onClick={() => setI(Math.max(0, i - 1))} /><Button variant="quiet" size="sm" icon="chevron-right" label="Next" onClick={() => setI(Math.min(5, i + 1))} /><span className="oc-num oc-meta">{i + 1} / 6</span><ToolbarSpacer /><Button variant="quiet" size="sm" icon="zoom-in" label="Zoom in" /><Button variant="quiet" size="sm" icon="expand" label="Full screen" /></Toolbar>}
      stage={<div style={{ position: "relative", width: "78%", aspectRatio: "3 / 2" }}><Ph /><span style={{ position: "absolute", inset: "8%", border: "1px solid var(--over-frame)", outline: "1px solid var(--over-frame-outline)" }} /><span className="oc-cam__label" style={{ left: 6, bottom: 6 }}>Item {i + 1}</span></div>}
      strip={[0, 1, 2, 3, 4, 5].map((k) => <ThumbnailTile key={k} selected={k === i} style={{ width: 56, flex: "none" }} onClick={() => setI(k)}><Ph /></ThumbnailTile>)}
      inspector={<PropertyList><PropertySection title="Properties" icon="info"><PropertyRow label="Field A" value="24" unit="mm" numeric /><PropertyRow label="Field B" value="36 × 24" unit="mm" numeric /><PropertyRow label="Field C" value="Value" /></PropertySection><PropertySection title="Group" icon="tag" defaultOpen={false} /></PropertyList>} />
  );
}

function EditorSpecimen() {
  const [tool, setTool] = useState("select");
  return (
    <EditorLayout inspectorWidth={190}
      toolbar={<Toolbar><Button variant="quiet" size="sm" icon="undo" label="Undo" /><Button variant="quiet" size="sm" icon="redo" label="Redo" /><ToolbarSpacer /><span className="oc-num oc-meta">100 %</span></Toolbar>}
      toolRail={<ToolRail value={tool} onChange={setTool} tools={[{ id: "select", icon: "crosshair", label: "Select", kbd: "V" }, { id: "frame", icon: "frame", label: "Frame", kbd: "F" }, { id: "brush", icon: "brush", label: "Draw", kbd: "B" }, { id: "note", icon: "note", label: "Note", kbd: "N" }, { separator: true }, { id: "ruler", icon: "ruler", label: "Measure", kbd: "M" }]} />}
      canvas={<div style={{ position: "absolute", left: 40, top: 30, width: 200, height: 130, background: "var(--surface)", border: "1px solid var(--border-control)" }}><span style={{ position: "absolute", inset: -1, outline: "2px solid var(--accent)", outlineOffset: 2 }} /></div>}
      inspector={<PropertyList><PropertySection title="Object" icon="frame"><PropertyRow label="X" value="40" numeric /><PropertyRow label="Y" value="30" numeric /><PropertyRow label="W" value="200" numeric /><PropertyRow label="H" value="130" numeric /></PropertySection></PropertyList>}
      statusBar={<StatusBar>1 object selected · tool <strong>{tool}</strong></StatusBar>} />
  );
}

function TrackSpecimen() {
  const [t, setT] = useState(14);
  const [sel, setSel] = useState("b2");
  return (
    <TrackLayout duration={48} scale={10} tick={4} playhead={t} onSeek={setT} selected={sel} onSelect={setSel}
      toolbar={<Toolbar><Button variant="quiet" size="sm" icon="skip-back" label="Start" onClick={() => setT(0)} /><Button variant="quiet" size="sm" icon="play" label="Play" /><span className="oc-num" style={{ padding: "0 6px" }}>{Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, "0")}</span><ToolbarSpacer /><Button variant="quiet" size="sm" icon="zoom-out" label="Zoom out" /><Button variant="quiet" size="sm" icon="zoom-in" label="Zoom in" /></Toolbar>}
      lanes={[
        { id: "a", label: "Lane A", color: 5, items: [{ id: "a1", start: 0, end: 9, label: "Item 1" }, { id: "a2", start: 9, end: 22, label: "Item 2" }, { id: "a3", start: 22, end: 30, label: "Item 3" }] },
        { id: "b", label: "Lane B", color: 1, items: [{ id: "b1", start: 4, end: 12, label: "Item 4" }, { id: "b2", start: 14, end: 26, label: "Item 5" }] },
        { id: "c", label: "Lane C", color: 3, items: [{ id: "c1", start: 0, end: 36, label: "Item 6" }] },
        { id: "d", label: "Lane D", color: 7, items: [{ id: "d1", start: 18, end: 21, label: "M" }, { id: "d2", start: 30, end: 33, label: "M" }] },
      ]}
      statusBar={<StatusBar>4 lanes · <strong>Item 5</strong> · 0:14 – 0:26</StatusBar>} />
  );
}

function SettingsSpecimen() {
  const [s, setS] = useState("general");
  const [on, setOn] = useState(true);
  return (
    <SettingsLayout value={s} onChange={setS} title="General"
      sections={[{ items: [{ id: "general", label: "General", icon: "settings" }, { id: "display", label: "Display", icon: "desktop" }, { id: "keys", label: "Keyboard", icon: "keyboard" }, { id: "acc", label: "Account", icon: "user" }] }]}>
      <SettingsGroup title="Group one"><FormField label="Field label" hint="A short hint under the field"><TextInput defaultValue="Value" /></FormField><FormField label="Choice"><Select options={[{ value: "a", label: "Option A" }, { value: "b", label: "Option B" }]} value="a" /></FormField></SettingsGroup>
      <SettingsGroup title="Group two"><Switch checked={on} onChange={setOn}>A setting that applies at once</Switch><FormField label="Number"><NumberInput value={24} unit="mm" style={{ width: 120 }} /></FormField></SettingsGroup>
    </SettingsLayout>
  );
}

type Row = { id: string } & Record<string, string>;
const TROWS: Row[] = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: "Row " + (i + 1), a: String((i * 7) % 13 + 1), b: (12.5 * (i + 1)).toFixed(1), c: ["Open", "Done", "Open", "Hold"][i % 4] }));
function TableSpecimen() {
  const [sel, setSel] = useState(["2"]);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [p, setP] = useState(1);
  const rows = [...TROWS].sort((x, y) => (isNaN(Number(x[sort.key])) ? (x[sort.key] > y[sort.key] ? 1 : -1) : Number(x[sort.key]) - Number(y[sort.key])) * (sort.dir === "asc" ? 1 : -1));
  return (
    <TableLayout
      toolbar={<Toolbar><SearchInput size="sm" value="" style={{ width: 160 }} /><ToolbarSpacer /><Button size="sm" icon="download">Export</Button><Button size="sm" variant="primary" icon="plus">Add</Button></Toolbar>}
      filters={<><Chip selected>Filter A</Chip><Chip>Filter B</Chip><Chip onRemove={() => undefined} icon="tag">Tag</Chip></>}
      footer={<Pagination page={p} pageCount={6} onChange={setP} />}
      statusBar={<StatusBar>48 rows · <strong>{sel.length} selected</strong></StatusBar>}>
      <Table selectable sort={sort} onSort={setSort} selected={sel} onSelect={setSel} columns={[{ key: "name", label: "Name", sortable: true }, { key: "a", label: "Count", numeric: true, sortable: true }, { key: "b", label: "Value", numeric: true, sortable: true }, { key: "c", label: "State" }]} rows={rows} />
    </TableLayout>
  );
}

interface LayoutDef { title: string; glyph: IconName; color: number; C: ComponentType }
// The export lists the viewer under "photo" and maps it to the "image" glyph; written here with the mapped name.
const LAYOUTS: LayoutDef[] = [
  { title: "Browser", glyph: "files", color: 5, C: BrowserSpecimen },
  { title: "Viewer with inspector", glyph: "image", color: 6, C: ViewerSpecimen },
  { title: "Editor with canvas", glyph: "brush", color: 1, C: EditorSpecimen },
  { title: "Track editor", glyph: "timeline", color: 8, C: TrackSpecimen },
  { title: "Settings", glyph: "settings", color: 0, C: SettingsSpecimen },
  { title: "Table", glyph: "list", color: 3, C: TableSpecimen },
];

function LayoutWindow({ l, w = 600, h = 340, focused = true }: { l: LayoutDef; w?: number; h?: number; focused?: boolean }) {
  return (
    <div style={{ position: "relative", width: w, height: h, flex: "none" }}>
      <AppWindow title={l.title} icon={<AppIcon glyph={l.glyph} color={l.color} size={16} />} focused={focused} onMinimize={() => undefined} onMaximize={() => undefined} onClose={() => undefined} style={{ inset: 0 }}><l.C /></AppWindow>
    </div>
  );
}

/** The six window templates with a Light / Dark switch; the theme sits on the kit root and persists. */
export default function Layouts() {
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("oc-layouts-theme") || "light"; } catch { return "light"; } });
  useEffect(() => { try { localStorage.setItem("oc-layouts-theme", theme); } catch { /* storage unavailable: keep in memory only */ } }, [theme]);
  return (
    <div className="kit-layouts" data-theme={theme}>
      <div className="bar"><Segmented value={theme} onChange={setTheme} label="Theme" options={[{ value: "light", label: "Light", icon: "sun" }, { value: "dark", label: "Dark", icon: "moon" }]} /><span className="oc-meta">Six window templates. Placeholder content only; every part is interactive.</span></div>
      <div className="grid">{LAYOUTS.map((l) => <LayoutWindow key={l.title} l={l} />)}</div>
    </div>
  );
}
