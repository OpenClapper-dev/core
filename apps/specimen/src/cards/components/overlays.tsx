// Port of components/overlays/overlays.card.html.
import { Banner, Button, CommandPalette, Confirm, DropdownMenu, Menu, NumberInput, Popover, Toast, type MenuItemData } from "@openclapper/design";
import { L, Pair } from "../../kit";

const ITEMS: MenuItemData[] = [{ id: "open", label: "Open", icon: "external", kbd: "Enter" }, { id: "ren", label: "Rename", icon: "edit", kbd: "F2" }, { id: "grid", label: "Show grid", checked: true }, { separator: true }, { id: "del", label: "Move to bin", icon: "trash", kbd: "Del", danger: true }, { id: "x", label: "Share", disabled: true }];

function Demo() {
  return (
    <div>
      <L>banner · info, warning, danger</L>
      <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
        <Banner tone="info" title="Read only" action={<Button size="sm">Request access</Button>}>You can view this project.</Banner>
        <Banner tone="warning" onDismiss={() => {}}>Offline. Changes sync when you reconnect.</Banner>
        <Banner tone="danger">Upload failed · 2 files</Banner>
      </div>
      <L>menu (cursor on Rename) · dropdown · popover</L>
      <div className="r" style={{ alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <Menu items={ITEMS} cursor="ren" />
        <div style={{ display: "grid", gap: 8 }}>
          <DropdownMenu label="Sort" size="sm" items={[{ id: "n", label: "Name", checked: true }, { id: "d", label: "Date" }]} />
          <Popover trigger={<Button size="sm" icon="filter">Filter</Button>}><NumberInput value={24} unit="mm" /></Popover>
          <Toast tone="success" action={{ label: "Undo" }}>2 photos moved</Toast>
          <Toast loading>Uploading 3 of 12</Toast>
        </div>
      </div>
      <L>dialog · command palette (shown in a frame)</L>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
        <div style={{ position: "relative", height: 250, border: "1px solid var(--border-window)" }}><Confirm danger title="Delete 2 photos?" message="They move to the recycle bin." confirmLabel="Delete" onCancel={() => {}} /></div>
        <div style={{ position: "relative", height: 250, border: "1px solid var(--border-window)", overflow: "hidden" }}><CommandPalette defaultQuery="" items={[{ id: "a", label: "Open files", icon: "folder", group: "Apps" }, { id: "b", label: "New window", icon: "window", kbd: "Ctrl+N", group: "Commands" }, { id: "c", label: "Switch to Dark", icon: "moon", group: "Commands" }]} /></div>
      </div>
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
