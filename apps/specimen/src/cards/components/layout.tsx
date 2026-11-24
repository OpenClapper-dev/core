// Port of components/layout/layout.card.html.
import { useState } from "preact/hooks";
import { Badge, Button, Card as DsCard, Dock, FormField, Icon, moved, useSort, type DockLayout, NumberInput, PropertyList, PropertyRow, PropertySection, SplitView, StatusBar, TextInput, Toolbar, ToolbarSpacer } from "@openclapper/design";
import { L, Pair } from "../../kit";

/** Panels the user arranges, and a list reordered by dragging: both also work from the keyboard. */
function Arranging() {
  const [layout, setLayout] = useState<DockLayout>({ left: { tabs: ["folders"] }, right: { tabs: ["props", "notes"] } });
  const [items, setItems] = useState(["Wide shot", "Over the shoulder", "Close-up", "Insert"]);
  const sort = useSort("y", (from, to) => setItems((l) => moved(l, from, to)));
  const fill = { padding: 8, color: "var(--text-secondary)" };
  return (
    <>
      <L>dock · drag a panel by its grip onto an edge, a half of another panel, or its tabs · grip focused: ← → ↓ move it, Enter folds it</L>
      <div style={{ display: "flex", height: 190, border: "1px solid var(--border-window)", borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
        <Dock layout={layout} onLayoutChange={setLayout} zoneSizes={{ left: 120, right: 150, bottom: 70 }} panels={[
          { id: "folders", title: "Folders", icon: "folder", body: <div style={fill}>Tree</div> },
          { id: "props", title: "Properties", icon: "info", body: <div style={fill}>Fields</div> },
          { id: "notes", title: "Notes", icon: "note", body: <div style={fill}>Text</div> },
        ]}><div style={fill}>The app's own content</div></Dock>
      </div>
      <L>reorder · drag a row by its grip · grip focused: Alt ↑ ↓ moves it</L>
      <div style={{ display: "grid", gap: 4, marginBottom: 12 }}>
        {items.map((it, i) => (
          <div key={it} data-sort style={{ display: "flex", alignItems: "center", gap: 8, height: 28, padding: "0 8px", border: "1px solid var(--border-divider)", borderRadius: 4, background: "var(--surface)", ...sort.style(i) }}>
            <i role="button" tabIndex={0} aria-label={`Move ${it}`} style={{ display: "grid", cursor: "grab" }} onPointerDown={sort.start(i)} onKeyDown={sort.keys(i, items.length)}><Icon name="grip" size={12} /></i>{it}
          </div>
        ))}
        {sort.ghost((from) => <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 8px", border: "1px solid var(--border-control)", borderRadius: 4, background: "var(--surface-raised)" }}><Icon name="grip" size={12} />{items[from]}</div>)}
      </div>
    </>
  );
}

function Demo() {
  return (
    <div>
      <Arranging />
      <L>toolbar · split view · status bar</L>
      <div style={{ display: "flex", flexDirection: "column", height: 150, border: "1px solid var(--border-window)", borderRadius: 6, overflow: "hidden", marginBottom: 12 }}>
        <Toolbar><Button variant="quiet" size="sm" icon="chevron-left" label="Back" /><Button variant="quiet" size="sm" icon="grid" label="Grid" selected /><ToolbarSpacer /><Button size="sm" variant="primary" icon="plus">Add</Button></Toolbar>
        <SplitView defaultSize={110} min={60} max={200}><div style={{ padding: 8, background: "var(--surface-sunken)", height: "100%", color: "var(--text-secondary)" }}>Pane</div><div style={{ padding: 8, color: "var(--text-secondary)" }}>Drag the grip</div></SplitView>
        <StatusBar>24 items · <strong>2 selected</strong> · 48.2 MB</StatusBar>
      </div>
      <L>property list · collapsible sections</L>
      <div style={{ border: "1px solid var(--border-divider)", marginBottom: 12 }}>
        <PropertyList>
          <PropertySection title="Optics" icon="lens"><PropertyRow label="Focal length" value="24" unit="mm" numeric /><PropertyRow label="Sensor" value="36 × 24" unit="mm" numeric /><PropertyRow label="Aperture"><NumberInput size="sm" value={2.8} step={0.1} style={{ width: 80, float: "right" }} /></PropertyRow></PropertySection>
          <PropertySection title="Position" icon="pin" defaultOpen={false} />
        </PropertyList>
      </div>
      <L>property value overflow · 220 px inspector · wrap (default) · truncate + tooltip · numbers never truncate</L>
      <div style={{ width: 220, border: "1px solid var(--border-divider)", marginBottom: 12 }}>
        <PropertyList>
          <PropertySection title="Overflow" icon="info">
            <PropertyRow label="Taken" value="12 Nov 2026 · 14:32:08" numeric />
            <PropertyRow label="Note" value="Back door to the yard, ask the caretaker for the key before 8" />
            <PropertyRow label="Path" overflow="truncate" value="/Harbour film/Scouting/Day 2/IMG_0151.jpg" />
            <PropertyRow label="Original camera model" value="X-T5" />
          </PropertySection>
        </PropertyList>
      </div>
      <L>form field · card</L>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ display: "grid", gap: 8 }}><FormField label="Name" hint="Shown in the taskbar"><TextInput defaultValue="Scouting" /></FormField><FormField label="Focal length" required error="Must be at least 1 mm"><NumberInput value={0} unit="mm" invalid /></FormField></div>
        <DsCard title="Storage" actions={<Badge tone="warning" icon="warning">82 %</Badge>} footer={<Button size="sm">Manage</Button>}><span className="oc-num">41.0 GB</span> <span className="oc-meta">of 50 GB</span></DsCard>
      </div>
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
