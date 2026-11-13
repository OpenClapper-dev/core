// Port of components/layouts/layouts.card.html.
import type { ComponentChildren } from "preact";
import { AppIcon, AppWindow, BrowserLayout, Button, Chip, EditorLayout, FormField, PropertyList, PropertyRow, PropertySection, SettingsGroup, SettingsLayout, SidebarNav, Switch, Table, TableLayout, TextInput, ThumbnailTile, ToolRail, Toolbar, ToolbarSpacer, TrackLayout, ViewerLayout, type IconName } from "@openclapper/design";

const Ph = () => <span style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg,#6a6a6a,#262626 70%)" }} />;
const Win = ({ t, g, c, children }: { t: string; g: IconName; c: number; children?: ComponentChildren }) => <div style={{ position: "relative", height: 190 }}><AppWindow title={t} icon={<AppIcon glyph={g} color={c} size={16} />} focused resizable={false} style={{ inset: 0, minWidth: 0 }}>{children}</AppWindow></div>;
const nav: { items: { id: string; label: string; icon: IconName }[] }[] = [{ items: [{ id: "a", label: "Section A", icon: "folder" }, { id: "b", label: "Section B", icon: "folder" }] }];

export default function Card() {
  return (
    <div className="one" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10, background: "var(--bg-desktop)" }}>
      <Win t="Browser" g="files" c={5}><BrowserLayout sidebarWidth={80} sidebar={<SidebarNav value="a" sections={nav} />} toolbar={<Toolbar><ToolbarSpacer /><Button size="sm" variant="primary" icon="plus" label="New" /></Toolbar>}><div style={{ padding: 6, display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 6 }}>{[1, 2, 3, 4].map((i) => <ThumbnailTile key={i} selected={i === 2}><Ph /></ThumbnailTile>)}</div></BrowserLayout></Win>
      <Win t="Viewer" g="image" c={6}><ViewerLayout inspectorWidth={180} stage={<div style={{ position: "relative", width: "80%", aspectRatio: "3/2" }}><Ph /></div>} inspector={<PropertyList><PropertySection title="Info"><PropertyRow label="A" value="24" numeric /><PropertyRow label="B" value="f/2.8" numeric /></PropertySection></PropertyList>} /></Win>
      <Win t="Editor" g="brush" c={1}><EditorLayout toolRail={<ToolRail value="s" tools={[{ id: "s", icon: "crosshair", label: "Select" }, { id: "b", icon: "brush", label: "Draw" }, { id: "n", icon: "note", label: "Note" }]} />} canvas={<div style={{ position: "absolute", left: 20, top: 20, width: 80, height: 54, background: "var(--surface)", border: "1px solid var(--border-control)", outline: "2px solid var(--accent)", outlineOffset: 2 }} />} /></Win>
      <Win t="Track editor" g="timeline" c={8}><TrackLayout duration={30} scale={7} tick={10} playhead={9} selected="b" lanes={[{ id: "x", label: "Lane A", color: 5, items: [{ id: "a", start: 0, end: 12, label: "Item" }, { id: "b", start: 12, end: 24, label: "Item" }] }, { id: "y", label: "Lane B", color: 1, items: [{ id: "c", start: 4, end: 18, label: "Item" }] }, { id: "z", label: "Lane C", color: 3, items: [{ id: "d", start: 0, end: 28, label: "Item" }] }]} /></Win>
      <Win t="Settings" g="settings" c={0}><SettingsLayout navWidth={96} value="a" sections={nav} style={{ fontSize: 12 }}><SettingsGroup title="Group"><FormField label="Field"><TextInput defaultValue="Value" /></FormField><Switch checked onChange={() => {}}>Setting</Switch></SettingsGroup></SettingsLayout></Win>
      <Win t="Table" g="list" c={3}><TableLayout filters={<Chip selected>Filter</Chip>}><Table columns={[{ key: "n", label: "Name" }, { key: "v", label: "Value", numeric: true }]} rows={[{ id: "1", n: "Row 1", v: "12.5" }, { id: "2", n: "Row 2", v: "25.0" }, { id: "3", n: "Row 3", v: "37.5" }]} selected={["2"]} /></TableLayout></Win>
    </div>
  );
}
