// UX workshop U6: the camera layout editor. A layout says which controls sit in which section of the camera (the
// strip over the picture, the lens rail, the control row), per orientation, with its look and options. The middle
// shows the phone's screen as the chosen device would draw it; the same picture is what a connected phone previews
// live. Specified in docs/rewrite/03-capture.md and ux-5-phone.md; today's editor: docs/features/viewfinder-layouts.md.
import { useState } from "preact/hooks";
import {
  Badge, Banner, Button, CameraButton, Checkbox, Dock, DropdownMenu, Icon, List, ListRow, PropertyList, PropertyRow, PropertySection, Segmented, Select, Shutter, Slider, Switch, TextInput, Toolbar, ToolbarSpacer, cx, useDockLayout,
  type DockPanel, type IconName,
} from "@openclapper/design";
import { ColourButton, css, type Colour } from "../u1/catalogue";
import { picture } from "../u1/pictures";
import { moved, useSort } from "../u3/sortable";

type Ctl = "shutter" | "uploads" | "collection" | "torch" | "reference" | "preset" | "lenses" | "focals" | "fit" | "blackout" | "upright" | "layout" | "folder" | "last" | "lights";
type Sec = "strip" | "rail" | "row";
interface Item { ctl: Ctl; label?: boolean; display?: "list" | "carousel" }
/** One orientation: what each section holds and at which edge the rail and the row stand. */
interface Arr { strip: Item[]; rail: Item[]; row: Item[]; railAt: "start" | "end"; rowAt: "start" | "end"; stripAt: "top" | "bottom" }
interface Look { color: Colour; width: number; tint: string; dim: number; hud: Record<string, boolean> }
interface Opts { reference: string; lenses: string; names: string }
export interface Layout { id: string; name: string; builtin?: boolean; device: string; portrait: Arr; landscape: Arr; look: Look; opts: Opts }

/** Every control a layout can place. Extensions add theirs; the shutter is needed exactly once. */
const CTL: Record<Ctl, { label: string; short: string; icon: IconName; kind?: "strip"; ext?: boolean; needs?: string }> = {
  shutter: { label: "Shutter", short: "", icon: "circle" }, uploads: { label: "Uploads", short: "Queue", icon: "cloud-upload" }, collection: { label: "Collection mode", short: "Coll.", icon: "layers" }, torch: { label: "Torch", short: "Torch", icon: "flashlight" },
  reference: { label: "Reference frame", short: "Ref.", icon: "user", needs: "an optics frame" }, preset: { label: "Optics preset", short: "Optics", icon: "lens" }, lenses: { label: "Phone lenses", short: "", icon: "camera", kind: "strip" }, focals: { label: "Focal lengths", short: "", icon: "ruler", kind: "strip", needs: "an optics preset" },
  fit: { label: "Fit to the frame", short: "Fit", icon: "expand", needs: "a frame" }, blackout: { label: "Blackout", short: "Black", icon: "contrast", needs: "a frame" }, upright: { label: "Frame upright", short: "Turn", icon: "rotate", needs: "an optics frame" },
  layout: { label: "Layout picker", short: "Layout", icon: "camera-layout" }, folder: { label: "Folder for the next photos", short: "Folder", icon: "folder" }, last: { label: "Last photo", short: "", icon: "image" }, lights: { label: "Lights (Hardware)", short: "Lights", icon: "light-fixture", ext: true },
};
const SECS: Record<Sec, string> = { strip: "Strip over the picture", rail: "Lens rail", row: "Control row" };
const HUD: [string, string][] = [["project", "Project"], ["lens", "Lens in use"], ["optics", "Preset and focal length"], ["fov", "Angle of view"], ["collection", "Collection"], ["folder", "Folder"], ["warnings", "Warnings"]];
export const DEVICES = [{ id: "pixel", name: "Pixel 9 Pro", w: 412, h: 915, lenses: ["0.5×", "1×", "5×"] }, { id: "tablet", name: "Pixel Tablet", w: 800, h: 1280, lenses: ["1×"] }, { id: "generic", name: "Generic phone", w: 400, h: 860, lenses: ["0.5×", "1×", "3×"] }];
const it = (...c: Ctl[]): Item[] => c.map((ctl) => ({ ctl }));
const LOOK: Look = { color: "#ffffff", width: 2, tint: "#000000", dim: 62, hud: { project: false, lens: true, optics: true, fov: false, collection: true, folder: false, warnings: true } };
const viewfinder = (id: string, name: string, builtin?: boolean): Layout => ({ id, name, builtin, device: "pixel", look: LOOK, opts: { reference: "cycle", lenses: "all", names: "account" },
  portrait: { strip: it("layout", "folder", "fit", "blackout", "upright"), rail: it("lenses", "focals"), row: it("uploads", "collection", "shutter", "reference", "torch", "preset"), railAt: "end", rowAt: "end", stripAt: "top" },
  landscape: { strip: it("layout", "folder", "fit", "blackout", "upright"), rail: it("lenses", "focals"), row: it("uploads", "collection", "shutter", "reference", "torch", "preset"), railAt: "start", rowAt: "end", stripAt: "top" } });
const START: Layout[] = [
  { ...viewfinder("camera", "Camera", true), portrait: { strip: it("layout", "folder"), rail: it("lenses"), row: it("uploads", "collection", "shutter", "torch", "last"), railAt: "end", rowAt: "end", stripAt: "top" }, landscape: { strip: it("layout", "folder"), rail: it("lenses"), row: it("uploads", "collection", "shutter", "torch", "last"), railAt: "start", rowAt: "end", stripAt: "top" } },
  viewfinder("viewfinder", "Viewfinder", true),
  { ...viewfinder("mine", "Scout, wide"), look: { ...LOOK, color: 2, width: 3, hud: { ...LOOK.hud, project: true, fov: true } }, portrait: { strip: it("layout", "fit"), rail: [{ ctl: "lenses", display: "carousel" }], row: [...it("last", "collection", "shutter"), { ctl: "torch", label: true }, { ctl: "folder", label: true }], railAt: "start", rowAt: "end", stripAt: "bottom" }, landscape: { strip: it("layout", "fit"), rail: [{ ctl: "lenses", display: "carousel" }], row: [...it("last", "collection", "shutter"), { ctl: "torch", label: true }, { ctl: "folder", label: true }], railAt: "end", rowAt: "end", stripAt: "bottom" } },
];

/** The camera as a device draws it from a layout. Nothing in it works: it shows where things sit and how they look. */
function Preview({ layout, land, hardware }: { layout: Layout; land: boolean; hardware: boolean }) {
  const a = land ? layout.landscape : layout.portrait, dev = DEVICES.find((d) => d.id === layout.device) ?? DEVICES[2];
  const [w, h] = land ? [dev.h, dev.w] : [dev.w, dev.h], k = Math.min(1, 640 / h, 900 / w);
  const framed = [...a.strip, ...a.rail, ...a.row].some((i) => ["preset", "focals", "fit", "blackout", "reference"].includes(i.ctl));
  const draw = (i: Item) => {
    const c = CTL[i.ctl];
    if (i.ctl === "lights" && !hardware) return null;
    if (i.ctl === "shutter") return <Shutter key="shutter" />;
    if (i.ctl === "last") return <span key="last" className="oc-cam__thumb u6-last"><img src={picture(17)} alt="" /></span>;
    if (c.kind === "strip") { const vals = i.ctl === "lenses" ? (layout.opts.lenses === "main" ? ["1×"] : dev.lenses) : ["24", "35", "50", "85"]; return i.display === "carousel" ? <CameraButton key={i.ctl} label={c.label}>‹ {vals[Math.min(1, vals.length - 1)]} ›</CameraButton> : <span key={i.ctl} className="u6-strip">{vals.map((v, n) => <CameraButton key={v} label={v} pressed={n === Math.min(1, vals.length - 1)}>{v}</CameraButton>)}</span>; }
    return <span key={i.ctl} className="u6-ctl"><CameraButton icon={c.icon} label={c.label} pressed={i.ctl === "blackout"} />{i.label && <small>{c.short}</small>}</span>;
  };
  const bar = (s: "rail" | "row") => <div key={s} className={cx("oc-cam__bar", s === "rail" ? "oc-cam__bar--a u5-rail" : "oc-cam__bar--b u5-row", "u6-bar")}>{a[s].map(draw)}</div>;
  const at = (edge: "start" | "end") => [a.railAt === edge && a.rail.length > 0 && bar("rail"), a.rowAt === edge && a.row.length > 0 && bar("row")];
  const hud = [layout.look.hud.project && "Nachtzug", layout.look.hud.lens && "24 mm lens", framed && layout.look.hud.optics && "Full frame primes · 35 mm", framed && layout.look.hud.fov && "54° × 38°", layout.look.hud.collection && "● Collection 3 · 2", layout.look.hud.folder && "Harbour", layout.look.hud.warnings && null].filter(Boolean);
  return (
    <div className="u6-device" style={{ width: w * k, height: h * k }}>
      <div className={cx("oc-cam", `oc-cam--${land ? "landscape" : "portrait"}`, "u5-cam")} style={{ width: w, height: h, scale: String(k) }}>
        {at("start")}
        <div className="oc-cam__view">
          <img className="u6-live" src={picture(12)} alt="" />
          {framed && <span className="u6-frame" style={{ borderColor: css(layout.look.color), borderWidth: layout.look.width, boxShadow: a.strip.concat(a.row, a.rail).some((i) => i.ctl === "blackout") ? `0 0 0 2000px color-mix(in srgb, ${layout.look.tint} ${layout.look.dim}%, transparent)` : undefined }} />}
          {a.strip.length > 0 && <div className={cx("u5-top", a.stripAt === "bottom" && "u6-top--bottom")}>{a.strip.map(draw)}</div>}
          {hud.length > 0 && <span className={cx("oc-cam__label u5-hud", a.stripAt === "bottom" && "u6-hud--top")}>{hud.join(" · ")}</span>}
        </div>
        {at("end")}
        <div className={cx("u6-tabs", land && "is-side")}>{(["camera", "image", "slate", "settings"] as IconName[]).map((n) => <Icon key={n} name={n} size={20} />)}</div>
      </div>
    </div>
  );
}

export default function Layouts({ hardware, say }: { hardware: boolean; say: (m: string) => void }) {
  const [layouts, setLayouts] = useState<Layout[]>(START);
  const [cur, setCur] = useState("mine");
  const [land, setLand] = useState(false);
  const [phone, setPhone] = useState("connected");
  const [panels, setPanels, reset] = useDockLayout("u6-layouts", { left: { tabs: ["list"] }, right: { tabs: ["sections", "look", "options"] } });
  const layout = layouts.find((l) => l.id === cur)!, key = land ? "landscape" : "portrait", a = layout[key], locked = !!layout.builtin;
  const patch = (c: Partial<Layout>) => setLayouts(layouts.map((l) => (l.id === cur ? { ...l, ...c } : l)));
  const arr = (c: Partial<Arr>) => patch({ [key]: { ...a, ...c } });
  const copy = (from: Layout) => { const id = `l${Date.now()}`; setLayouts([...layouts, { ...from, id, builtin: false, name: `${from.name}, copy` }]); setCur(id); say(`A copy of “${from.name}” to change`); };
  const used = [...a.strip, ...a.rail, ...a.row].map((i) => i.ctl), noShutter = !used.includes("shutter");
  const sorts = { strip: useSort("y", (x, y) => arr({ strip: moved(a.strip, x, y) })), rail: useSort("y", (x, y) => arr({ rail: moved(a.rail, x, y) })), row: useSort("y", (x, y) => arr({ row: moved(a.row, x, y) })) };
  const edges = land ? [["start", "Left"], ["end", "Right"]] : [["start", "Top"], ["end", "Bottom"]];

  const section = (s: Sec) => (
    <PropertySection key={s} title={`${SECS[s]} · ${a[s].length}`} icon={s === "strip" ? "rows" : s === "rail" ? "camera" : "apps"}>
      <PropertyRow label="Stands">{s === "strip" ? <Segmented label="Strip position" value={a.stripAt} disabled={locked} onChange={(v) => arr({ stripAt: v as "top" | "bottom" })} options={[{ value: "top", label: "Top of the picture" }, { value: "bottom", label: "Bottom" }]} /> : <Segmented label={`${SECS[s]} position`} value={s === "rail" ? a.railAt : a.rowAt} disabled={locked} onChange={(v) => arr(s === "rail" ? { railAt: v as "start" | "end" } : { rowAt: v as "start" | "end" })} options={edges.map(([value, label]) => ({ value, label }))} />}</PropertyRow>
      <ul className="u6-items">
        {a[s].map((i, n) => { const c = CTL[i.ctl], off = i.ctl === "lights" && !hardware; return (
          <li key={i.ctl} data-sort className={cx("u6-item", off && "is-off")} style={sorts[s].style(n)} onPointerDown={locked ? undefined : sorts[s].start(n)}>
            <Icon name="grip" size={12} /><Icon name={c.icon} /><span className="u6-item__name">{c.label}{off && <small>needs the Hardware extension</small>}</span>
            {c.kind === "strip" ? <Segmented label="Shown as" value={i.display ?? "list"} disabled={locked} onChange={(v) => arr({ [s]: a[s].map((x) => (x.ctl === i.ctl ? { ...x, display: v as "list" | "carousel" } : x)) })} options={[{ value: "list", icon: "list", title: "All at once" }, { value: "carousel", icon: "arrow-right", title: "One at a time, stepped through" }]} />
              : i.ctl !== "shutter" && i.ctl !== "last" && <span data-nodrag><Checkbox checked={!!i.label} disabled={locked} onChange={(v) => arr({ [s]: a[s].map((x) => (x.ctl === i.ctl ? { ...x, label: v } : x)) })}>Label</Checkbox></span>}
            <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[...(Object.keys(SECS) as Sec[]).filter((x) => x !== s).map((x) => ({ id: x, label: `Move to: ${SECS[x]}`, icon: "arrow-right" as const, disabled: locked })), { separator: true as const }, { id: "remove", label: i.ctl === "shutter" ? "The shutter cannot be removed" : "Remove", icon: "close" as const, disabled: locked || i.ctl === "shutter" }]} onSelect={(x) => (x === "remove" ? arr({ [s]: a[s].filter((y) => y.ctl !== i.ctl) }) : arr({ [s]: a[s].filter((y) => y.ctl !== i.ctl), [x]: [...a[x as Sec], i] }))} />
          </li>
        ); })}
        {sorts[s].ghost((n) => <div className="u6-item is-ghost"><Icon name="grip" size={12} /><Icon name={CTL[a[s][n].ctl].icon} /><span className="u6-item__name">{CTL[a[s][n].ctl].label}</span></div>)}
      </ul>
      <div className="u6-pad"><DropdownMenu size="sm" variant="quiet" icon="plus" label="Add a control" items={(Object.keys(CTL) as Ctl[]).filter((c) => !used.includes(c)).map((c) => ({ id: c, label: CTL[c].label, icon: CTL[c].icon, disabled: locked || (!!CTL[c].ext && !hardware) }))} onSelect={(c) => arr({ [s]: [...a[s], { ctl: c as Ctl }] })} /></div>
    </PropertySection>
  );
  const dockPanels: DockPanel[] = [
    { id: "list", title: "Layouts", icon: "camera-layout", actions: <Button size="sm" icon="plus" onClick={() => copy(START[1])}>New layout</Button>, body: (
      <><List>{layouts.map((l) => <ListRow key={l.id} size="lg" icon={l.builtin ? "lock" : "camera-layout"} selected={l.id === cur} meta={l.builtin ? "Built in" : DEVICES.find((d) => d.id === l.device)?.name} onClick={() => setCur(l.id)}>{l.name}</ListRow>)}</List><p className="u6-note">Layouts belong to your account and follow you into every project. The built-in ones are always there to go back to: duplicate one to change it.</p></>
    ) },
    { id: "sections", title: "Sections", icon: "rows", body: <PropertyList key={cur + key}>{(["strip", "rail", "row"] as Sec[]).map(section)}<p className="u6-note">Each control at most once per orientation. Drag to reorder inside a section; the menu moves a control to another section. Upright and landscape are arranged separately.</p></PropertyList> },
    { id: "look", title: "Look", icon: "palette", body: (
      <PropertyList key={cur}>
        <PropertySection title="The frame" icon="frame">
          <PropertyRow label="Colour"><ColourButton value={layout.look.color} label="Frame colour" onChange={(c) => !locked && patch({ look: { ...layout.look, color: c } })} /></PropertyRow>
          <PropertyRow label="Width"><span className="u3-slide"><Slider min={1} max={6} value={layout.look.width} disabled={locked} onChange={(v) => patch({ look: { ...layout.look, width: v } })} /><b className="oc-num">{layout.look.width} px</b></span></PropertyRow>
        </PropertySection>
        <PropertySection title="Blackout" icon="contrast">
          <PropertyRow label="Tint"><Segmented label="Blackout tint" value={layout.look.tint} disabled={locked} onChange={(v) => patch({ look: { ...layout.look, tint: v } })} options={[{ value: "#000000", label: "Black" }, { value: "#3a0000", label: "Red" }, { value: "#00143a", label: "Blue" }]} /></PropertyRow>
          <PropertyRow label="Strength"><span className="u3-slide"><Slider min={20} max={100} step={2} value={layout.look.dim} disabled={locked} onChange={(v) => patch({ look: { ...layout.look, dim: v } })} /><b className="oc-num">{layout.look.dim} %</b></span></PropertyRow>
        </PropertySection>
        <PropertySection title="Readouts on the picture" icon="info">{HUD.map(([id, label]) => <div key={id} className="u6-pad"><Switch checked={!!layout.look.hud[id]} disabled={locked} onChange={(v) => patch({ look: { ...layout.look, hud: { ...layout.look.hud, [id]: v } } })}>{label}</Switch></div>)}</PropertySection>
      </PropertyList>
    ) },
    { id: "options", title: "Options", icon: "sliders", body: (
      <PropertyList key={cur}>
        <PropertySection title="Designed for" icon="mobile">
          <PropertyRow label="Device"><Select size="sm" value={layout.device} onChange={(v) => !locked && patch({ device: v })} options={DEVICES.map((d) => ({ value: d.id, label: `${d.name} · ${d.w} × ${d.h}` }))} /></PropertyRow>
          <p className="u6-note">The preview uses this device's screen and its real lenses, as the device reported them. On another device the layout is laid out for that one.</p>
        </PropertySection>
        <PropertySection title="Controls" icon="sliders">
          <PropertyRow label="Reference frame"><Select size="sm" value={layout.opts.reference} onChange={(v) => !locked && patch({ opts: { ...layout.opts, reference: v } })} options={[{ value: "cycle", label: "Steps through 35, 43, 50 mm" }, { value: "35", label: "On / off at 35 mm" }, { value: "43", label: "On / off at 43 mm" }, { value: "50", label: "On / off at 50 mm" }]} /></PropertyRow>
          <PropertyRow label="Phone lenses"><Select size="sm" value={layout.opts.lenses} onChange={(v) => !locked && patch({ opts: { ...layout.opts, lenses: v } })} options={[{ value: "all", label: "Every real lens" }, { value: "main", label: "The main lens only" }]} /></PropertyRow>
          <PropertyRow label="Lens names"><Select size="sm" value={layout.opts.names} onChange={(v) => !locked && patch({ opts: { ...layout.opts, names: v } })} options={[{ value: "account", label: "As set for the account" }, { value: "native", label: "The phone's names" }, { value: "mm", label: "Focal lengths" }]} /></PropertyRow>
        </PropertySection>
      </PropertyList>
    ) },
  ];
  return (
    <div className="oc-app u3-win">
      <Toolbar>
        <Icon name="camera-layout" size={20} />{locked ? <strong className="u3-title">{layout.name}</strong> : <TextInput size="sm" value={layout.name} aria-label="Name" style={{ width: 200 }} onInput={(e) => patch({ name: (e.target as HTMLInputElement).value })} />}
        {locked ? <Badge icon="lock">Built in, read-only</Badge> : <span className="u6-saved"><Icon name="check" size={12} />Saved</span>}
        <Segmented label="Orientation" value={key} onChange={(v) => setLand(v === "landscape")} options={[{ value: "portrait", label: "Upright" }, { value: "landscape", label: "Landscape" }]} />
        <ToolbarSpacer />
        <button type="button" className={cx("u6-pill", `is-${phone}`)} title="The phone link: click to step through its states" onClick={() => setPhone(phone === "none" ? "connected" : phone === "connected" ? "preview" : "none")}><i />{phone === "none" ? "No phone connected" : phone === "connected" ? "Pixel 9 Pro connected" : "Previewing on Pixel 9 Pro"}</button>
        <Button size="sm" icon="copy" onClick={() => copy(layout)}>Duplicate</Button>
        <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "reset", label: "Reset to the Viewfinder default", icon: "undo", disabled: locked }, { id: "delete", label: "Delete", icon: "trash", danger: true, disabled: locked }, { separator: true }, { id: "panels", label: "Panels back to their places", icon: "refresh" }]} onSelect={(x) => { if (x === "panels") reset(); else if (x === "reset") patch({ portrait: START[1].portrait, landscape: START[1].landscape, look: LOOK }); else { setLayouts(layouts.filter((l) => l.id !== cur)); setCur("viewfinder"); } }} />
      </Toolbar>
      <Dock panels={dockPanels} layout={panels} onLayoutChange={setPanels} zoneSizes={{ left: 240, right: 380 }}>
        <div className="u6-stage">
          {locked && <Banner tone="info" action={<Button size="sm" onClick={() => copy(layout)}>Duplicate to change</Button>}>A built-in layout cannot be changed.</Banner>}
          {noShutter && <Banner tone="warning">A layout needs the shutter in this orientation. It is not saved until it has one.</Banner>}
          <Preview layout={layout} land={land} hardware={hardware} />
          <p className="u6-note">{phone === "preview" ? "The connected phone shows this layout as you change it." : phone === "connected" ? "Click the pill above to preview on the phone." : "Without a phone the preview here is all there is."} Drawn for {DEVICES.find((d) => d.id === layout.device)?.name}.</p>
        </div>
      </Dock>
    </div>
  );
}
