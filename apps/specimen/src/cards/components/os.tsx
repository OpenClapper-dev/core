// Port of components/os/os.card.html.
import { AppIcon, AppWindow, Button, EnvMarker, FileTile, Launcher, StatusBar, Taskbar, TaskbarClock, Toolbar, ToolbarSpacer, type IconName } from "@openclapper/design";
import { L, Pair } from "../../kit";

const ai = (g: IconName, c: number, s?: number) => <AppIcon glyph={g} color={c} size={s || 16} />;

function Demo() {
  return (
    <div>
      <L>window · focused and unfocused, with toolbar and status bar</L>
      <div style={{ position: "relative", height: 150, background: "var(--bg-desktop)", marginBottom: 10 }}>
        <AppWindow title="Inspector" icon={ai("lens", 6)} onClose={() => {}} style={{ left: 140, top: 8, width: 150, height: 100 }} />
        <AppWindow title="Files · Scouting" icon={ai("folder", 5)} focused onMinimize={() => {}} onMaximize={() => {}} onClose={() => {}} style={{ left: 8, top: 28, width: 220, height: 114 }}
          toolbar={<Toolbar><Button variant="quiet" size="sm" icon="chevron-left" label="Back" /><ToolbarSpacer /><Button size="sm" variant="primary" icon="plus">Import</Button></Toolbar>}
          statusBar={<StatusBar>24 items</StatusBar>} />
      </div>
      <L>taskbar · active, running, minimised, system area</L>
      <div style={{ position: "relative", height: "var(--taskbar-h)", marginBottom: 10 }}>
        <Taskbar style={{ position: "absolute" }} tasks={[{ id: "f", title: "Files", icon: ai("folder", 5), state: "active" }, { id: "i", title: "Inspector", icon: ai("lens", 6), state: "running" }, { id: "t", title: "Timeline", icon: ai("film", 8), state: "minimized" }]}>
          <EnvMarker env="staging" /><TaskbarClock>14:32</TaskbarClock>
        </Taskbar>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
        <div>
          <L>file tiles · icon size: selected, shortcut, drop target, image</L>
          <div className="r" style={{ alignItems: "flex-start", gap: 2 }}><FileTile kind="folder" name="Scouting" selected /><FileTile kind="folder" name="Day 2" dropTarget /><FileTile kind="file" name="Notes.md" shortcut /><FileTile kind="image" name="Ref_04.jpg" /></div>
          <L>icon labels · two lines then ellipsis · selected shows up to four · shortcut badge bottom-left</L>
          <div className="r" style={{ alignItems: "flex-start", gap: 2, minHeight: 112 }}><FileTile kind="file" name="Call sheet day 2 harbour exteriors final.md" /><FileTile kind="file" name="Call sheet day 2 harbour exteriors final.md" selected /><FileTile kind="file" name="Call sheet.md" shortcut /><FileTile kind="folder" name="Scouting" shortcut selected /></div>
          <L>list size</L>
          <FileTile kind="folder" view="list" name="Scouting" meta="24 items" /><FileTile kind="image" view="list" name="Ref_04.jpg" meta="4.2 MB" selected />
          <L>environment · app icon 16 · 24 · 32 · 48 · off</L>
          <div className="r"><EnvMarker /><EnvMarker env="staging" /><EnvMarker env="development" /></div>
          <div className="r">{ai("camera", 1, 16)}{ai("camera", 1, 24)}{ai("camera", 1, 32)}{ai("camera", 1, 48)}<AppIcon glyph="sun" size={32} off /></div>
        </div>
        <div style={{ position: "relative" }}>
          <Launcher style={{ position: "static", width: "100%" }} apps={[{ id: "f", label: "Files", glyph: "folder", color: 5 }, { id: "c", label: "Camera", glyph: "camera", color: 1 }, { id: "m", label: "Map", glyph: "map", color: 3 }, { id: "t", label: "Timeline", glyph: "film", color: 8 }, { id: "s", label: "Settings", glyph: "sliders" }]} extensions={[{ id: "l", label: "Lights", glyph: "sun", color: 2 }, { id: "x", label: "Flows", glyph: "layers", enabled: false }]} />
        </div>
      </div>
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
