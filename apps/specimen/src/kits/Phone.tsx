// Phone companion specimen (export ui_kits/phone): list, detail, camera, form. Composes design-system parts only.
import "./kits.css";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import {
  Screen, ScreenHeader, HeaderAction, BottomTabs, BottomSheet, ActionBar, TouchButton, PullToRefresh, CameraLayout, CameraButton, Shutter,
  List, ListRow, PropertyList, PropertySection, PropertyRow, FormField, TextInput, Segmented, Switch, Badge,
  type IconName,
} from "@openclapper/design";
import { AndroidDevice } from "./AndroidFrame";

const PPh = () => <span style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg,#6a6a6a,#262626 70%)" }} />;
const ITEMS: [string, string, string][] = [["a", "Item one", "1.2 km"], ["b", "Item two", "3.4 km"], ["c", "Item three", "5.0 km"], ["d", "Item four", "8.7 km"], ["e", "Item five", "12 km"], ["f", "Item six", "14 km"]];
const SHEET_ACTIONS: [IconName, string][] = [["share", "Share"], ["edit", "Rename"], ["trash", "Move to bin"]];

function CameraScreen({ orientation = "portrait", onClose }: { orientation?: "portrait" | "landscape"; onClose?: () => void }) {
  const [grid, setGrid] = useState(true);
  const [shots, setShots] = useState(0);
  const barA = <><CameraButton icon="close" label="Close" onClick={onClose} /><span className="oc-cam__readout">24 mm · f/2.8</span><CameraButton icon="grid" label="Grid" pressed={grid} onClick={() => setGrid((g) => !g)} /></>;
  const barB = <><button className="oc-cam__thumb" aria-label="Last photo"><span style={{ display: "block", width: "100%", height: "100%", background: "linear-gradient(160deg,#6a6a6a,#262626)" }} /></button><Shutter onClick={() => setShots((s) => s + 1)} /><CameraButton icon="lens" label="Lens" /></>;
  return (
    <CameraLayout orientation={orientation} barA={barA} barB={barB}>
      <PPh />
      {grid && <span style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(to right,transparent calc(33.33% - .5px),#fff calc(33.33% - .5px),#fff calc(33.33% + .5px),transparent calc(33.33% + .5px),transparent calc(66.66% - .5px),#fff calc(66.66% - .5px),#fff calc(66.66% + .5px),transparent calc(66.66% + .5px)),linear-gradient(to bottom,transparent calc(33.33% - .5px),#fff calc(33.33% - .5px),#fff calc(33.33% + .5px),transparent calc(33.33% + .5px),transparent calc(66.66% - .5px),#fff calc(66.66% - .5px),#fff calc(66.66% + .5px),transparent calc(66.66% + .5px))", opacity: 0.6 }} />}
      <span style={{ position: "absolute", inset: "12% 8%", border: "1px solid var(--over-frame)", outline: "1px solid var(--over-frame-outline)" }} />
      <span className="oc-cam__label" style={{ left: "8%", top: "calc(12% + 6px)", marginLeft: 6 }}>Frame 2.39:1</span>
      {shots > 0 && <span className="oc-cam__label" style={{ right: 8, bottom: 8 }}>{shots} taken</span>}
    </CameraLayout>
  );
}

function PhoneApp() {
  const [tab, setTab] = useState("list");
  const [detail, setDetail] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("a");
  const [sw, setSw] = useState(true);
  const refresh = () => { setBusy(true); setTimeout(() => setBusy(false), 1200); };
  const tabs = <BottomTabs value={tab} onChange={(t) => { setTab(t); setDetail(null); }} tabs={[{ id: "list", label: "List", icon: "list" }, { id: "camera", label: "Camera", icon: "camera" }, { id: "form", label: "Form", icon: "edit" }]} />;
  if (tab === "camera") return <CameraScreen onClose={() => setTab("list")} />;
  if (tab === "form") return (
    <Screen padded header={<ScreenHeader title="New item" />} footer={<ActionBar><TouchButton onClick={() => setTab("list")}>Cancel</TouchButton><TouchButton variant="primary" icon="check">Save</TouchButton></ActionBar>}>
      <FormField label="Name" hint="Shown in lists"><TextInput defaultValue="Item seven" /></FormField>
      <FormField label="Kind"><Segmented value={mode} onChange={setMode} label="Kind" options={[{ value: "a", label: "Kind A" }, { value: "b", label: "Kind B" }, { value: "c", label: "Kind C" }]} /></FormField>
      <FormField label="Code" error="Use letters and numbers only"><TextInput defaultValue="A-7/" invalid /></FormField>
      <Switch checked={sw} onChange={setSw}>Keep location</Switch>
    </Screen>
  );
  const it = detail ? ITEMS.find((i) => i[0] === detail) : undefined;
  if (it) {
    return (
      <Screen header={<ScreenHeader title={it[1]} subtitle={it[2] + " away"} onBack={() => setDetail(null)} actions={<HeaderAction icon="more-vertical" label="More" onClick={() => setSheet(true)} />} />}
        footer={<ActionBar><TouchButton icon="map">Map</TouchButton><TouchButton variant="primary" icon="camera" onClick={() => setTab("camera")}>Photo</TouchButton></ActionBar>}>
        <div style={{ position: "relative", aspectRatio: "3 / 2", background: "var(--photo-bg)" }}><PPh /><span className="oc-cam__label" style={{ left: 8, bottom: 8 }}>1 / 12</span></div>
        <div style={{ padding: "12px 16px", display: "flex", gap: 8 }}><Badge tone="success" icon="check">Approved</Badge><Badge>Tag</Badge></div>
        <PropertyList><PropertySection title="Properties" icon="info"><PropertyRow label="Field A" value="52.5200° N" numeric /><PropertyRow label="Field B" value="±5" unit="m" numeric /><PropertyRow label="Field C" value="12 Nov · 14:32" numeric /></PropertySection></PropertyList>
        {sheet && <BottomSheet title="Actions" onClose={() => setSheet(false)}><List>{SHEET_ACTIONS.map(([ic, l]) => <ListRow key={ic} size="touch" icon={ic} onClick={() => setSheet(false)}>{l}</ListRow>)}</List></BottomSheet>}
      </Screen>
    );
  }
  return (
    <Screen scroll={false} header={<ScreenHeader title="Items" actions={<><HeaderAction icon="search" label="Search" /><HeaderAction icon="filter" label="Filter" /></>} />} footer={tabs}>
      <PullToRefresh refreshing={busy} onRefresh={refresh} style={{ position: "absolute", inset: 0 }}>
        <List>{ITEMS.map(([id, name, meta]) => <ListRow key={id} size="touch" icon="pin" meta={meta} chevron onClick={() => setDetail(id)}>{name}</ListRow>)}</List>
        <div style={{ padding: 16, display: "flex", justifyContent: "center" }}><TouchButton variant="quiet" icon="refresh" onClick={refresh}>Refresh</TouchButton></div>
      </PullToRefresh>
    </Screen>
  );
}

const Dev = ({ label, theme, w = 380, h = 820, children }: { label: string; theme: "light" | "dark"; w?: number; h?: number; children?: ComponentChildren }) => (
  <div className="dev"><span>{label}</span>
    <div data-theme={theme}><AndroidDevice width={w} height={h} dark={theme === "dark"}><div className="fill">{children}</div></AndroidDevice></div>
  </div>
);

/** Three devices: the app in Light and Dark, and the camera in landscape. Each device carries its own data-theme. */
export default function Phone() {
  return (
    <div className="kit-phone">
      <Dev label="Light · tap a row, pull the list, try the tabs" theme="light"><PhoneApp /></Dev>
      <Dev label="Dark" theme="dark"><PhoneApp /></Dev>
      <Dev label="Camera · landscape, bars on the short edges" theme="dark" w={820} h={380}><CameraScreen orientation="landscape" /></Dev>
    </div>
  );
}
