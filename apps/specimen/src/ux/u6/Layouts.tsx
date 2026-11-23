// UX workshop U6: the camera layout editor. A layout is a set of bars around the camera's picture, per orientation.
// A bar stands at one of the four edges, bars at one edge stack, and each bar holds controls in an order and with a
// distribution. Controls are dragged between bars, in the list at the right and directly in the preview. The middle
// shows the camera as the chosen device would draw it; a connected phone previews the same picture live.
// Specified in docs/rewrite/03-capture.md and ux-5-phone.md; today's editor: docs/features/viewfinder-layouts.md.
import { createPortal } from "preact/compat";
import { useState } from "preact/hooks";
import {
  Badge, Banner, Button, CameraButton, Checkbox, Dock, DropdownMenu, Icon, List, ListRow, PropertyList, PropertyRow, PropertySection, Segmented, Select, Shutter, Slider, Switch, TextInput, Toolbar, ToolbarSpacer, cx, useDockLayout,
  type DockPanel, type IconName,
} from "@openclapper/design";
import { ColourButton, css, type Colour } from "../u1/catalogue";
import { picture } from "../u1/pictures";

type Ctl = "r-project" | "r-lens" | "r-optics" | "r-fov" | "r-collection" | "r-folder" | "r-warn" | "shutter" | "uploads" | "collection" | "torch" | "reference" | "preset" | "lenses" | "focals" | "fit" | "blackout" | "upright" | "layout" | "folder" | "last" | "lights";
type Edge = "top" | "bottom" | "left" | "right";
type Dist = "start" | "center" | "end" | "between" | "around";
interface Item { ctl: Ctl; label?: boolean; display?: "list" | "carousel" }
/** A bar: where it stands, how its controls are spread along it, and the controls in screen order. */
interface Bar { id: string; name: string; edge: Edge; dist: Dist; items: Item[]; /** Lies over the picture and takes no room from it. */ over?: boolean }
interface Look { color: Colour; width: number; tint: string; dim: number }
interface Opts { reference: string; lenses: string; names: string }
export interface Layout { id: string; name: string; builtin?: boolean; device: string; portrait: Bar[]; landscape: Bar[]; look: Look; opts: Opts }

/** Every control a layout can place. Extensions add theirs; the shutter is needed exactly once. */
const CTL: Record<Ctl, { label: string; short: string; icon: IconName; kind?: "strip" | "readout"; ext?: boolean }> = {
  // Readouts are controls too: a tag that shows a value. `short` is the sample the preview shows.
  "r-project": { label: "Readout: project", short: "Nachtzug", icon: "info", kind: "readout" }, "r-lens": { label: "Readout: lens in use", short: "24 mm lens", icon: "info", kind: "readout" }, "r-optics": { label: "Readout: preset and focal length", short: "Full frame primes · 35 mm", icon: "info", kind: "readout" }, "r-fov": { label: "Readout: angle of view", short: "54° × 38°", icon: "info", kind: "readout" },
  "r-collection": { label: "Readout: collection", short: "Collection 3 · 2", icon: "info", kind: "readout" }, "r-folder": { label: "Readout: folder", short: "Harbour", icon: "info", kind: "readout" }, "r-warn": { label: "Readout: warnings", short: "Wider than this lens", icon: "warning", kind: "readout" },
  shutter: { label: "Shutter", short: "", icon: "circle" }, uploads: { label: "Uploads", short: "Queue", icon: "cloud-upload" }, collection: { label: "Collection mode", short: "Coll.", icon: "layers" }, torch: { label: "Torch", short: "Torch", icon: "flashlight" },
  reference: { label: "Reference frame", short: "Ref.", icon: "user" }, preset: { label: "Optics preset", short: "Optics", icon: "lens" }, lenses: { label: "Phone lenses", short: "", icon: "camera", kind: "strip" }, focals: { label: "Focal lengths", short: "", icon: "ruler", kind: "strip" },
  fit: { label: "Fit to the frame", short: "Fit", icon: "expand" }, blackout: { label: "Blackout", short: "Black", icon: "contrast" }, upright: { label: "Frame upright", short: "Turn", icon: "rotate" },
  layout: { label: "Layout picker", short: "Layout", icon: "camera-layout" }, folder: { label: "Folder for the next photos", short: "Folder", icon: "folder" }, last: { label: "Last photo", short: "", icon: "image" }, lights: { label: "Lights (Hardware)", short: "Lights", icon: "light-fixture", ext: true },
};
const EDGES: [Edge, string][] = [["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]];
const DISTS: [Dist, string, string][] = [["start", "Start", "Packed at the start of the bar"], ["center", "Centre", "Packed in the middle"], ["end", "End", "Packed at the end"], ["between", "Between", "Spread out, first and last at the ends"], ["around", "Around", "Spread out with room at the ends too"]];
export const DEVICES = [{ id: "pixel", name: "Pixel 9 Pro", w: 412, h: 915, lenses: ["0.5×", "1×", "5×"] }, { id: "tablet", name: "Pixel Tablet", w: 800, h: 1280, lenses: ["1×"] }, { id: "generic", name: "Generic phone", w: 400, h: 860, lenses: ["0.5×", "1×", "3×"] }];
const it = (...c: Ctl[]): Item[] => c.map((ctl) => ({ ctl }));
const bar = (id: string, edge: Edge, dist: Dist, items: Item[], over?: boolean): Bar => ({ id, name: over ? "Readouts" : `Bar ${id.slice(1)}`, edge, dist, items, over });
const LOOK: Look = { color: "#ffffff", width: 2, tint: "#000000", dim: 62 };
/** Readouts start in a bar of their own that lies over the picture. */
const READ = (...c: Ctl[]) => bar("b0", "top", "start", it(...c), true);
const ROW = it("uploads", "collection", "shutter", "reference", "torch", "preset"), TOOLS = it("layout", "folder", "fit", "blackout", "upright");
/** The built-in arrangement follows today's app: upright, lenses above the control row at the bottom; landscape, lenses left and controls right. */
const viewfinder = (id: string, name: string, builtin?: boolean): Layout => ({ id, name, builtin, device: "pixel", look: LOOK, opts: { reference: "cycle", lenses: "all", names: "account" },
  portrait: [bar("b1", "top", "between", TOOLS), READ("r-lens", "r-optics", "r-collection", "r-warn"), bar("b2", "bottom", "start", it("lenses", "focals")), bar("b3", "bottom", "between", ROW)],
  landscape: [bar("b1", "top", "between", TOOLS), READ("r-lens", "r-optics", "r-collection", "r-warn"), bar("b2", "left", "start", it("lenses", "focals")), bar("b3", "right", "between", ROW)] });
const START: Layout[] = [
  { ...viewfinder("camera", "Camera", true), portrait: [bar("b1", "top", "start", it("layout", "folder")), READ("r-lens", "r-collection"), bar("b2", "bottom", "start", it("lenses")), bar("b3", "bottom", "between", it("uploads", "collection", "shutter", "torch", "last"))], landscape: [bar("b1", "top", "start", it("layout", "folder")), READ("r-lens", "r-collection"), bar("b2", "left", "start", it("lenses")), bar("b3", "right", "between", it("uploads", "collection", "shutter", "torch", "last"))] },
  viewfinder("viewfinder", "Viewfinder", true),
  { ...viewfinder("mine", "Scout, wide"), look: { ...LOOK, color: 2, width: 3 },
    portrait: [READ("r-project", "r-lens", "r-optics", "r-fov", "r-collection", "r-warn"), bar("b1", "top", "center", [{ ctl: "lenses", display: "carousel" }, { ctl: "focals", display: "carousel" }]), bar("b2", "left", "end", it("fit", "blackout")), bar("b3", "bottom", "around", [...it("last", "collection", "shutter"), { ctl: "torch", label: true }, { ctl: "folder", label: true }])],
    landscape: [READ("r-project", "r-lens", "r-optics", "r-fov", "r-collection", "r-warn"), bar("b1", "left", "center", [{ ctl: "lenses", display: "carousel" }, { ctl: "focals", display: "carousel" }]), bar("b2", "bottom", "end", it("fit", "blackout")), bar("b3", "right", "around", [...it("last", "collection", "shutter"), { ctl: "torch", label: true }, { ctl: "folder", label: true }])] },
];
const upright = (e: Edge) => e === "left" || e === "right";

export default function Layouts({ hardware, say }: { hardware: boolean; say: (m: string) => void }) {
  const [layouts, setLayouts] = useState<Layout[]>(START);
  const [cur, setCur] = useState("mine");
  const [land, setLand] = useState(false);
  const [phone, setPhone] = useState("connected");
  const [drag, setDrag] = useState<{ ctl: Ctl; x: number; y: number; line: [number, number, number, number] | null; root: Element } | null>(null);
  const [panels, setPanels, reset] = useDockLayout("u6-layouts-3", { left: { tabs: ["list"] }, right: { tabs: ["bars", "look", "options"] } });
  const layout = layouts.find((l) => l.id === cur)!, key = land ? "landscape" : "portrait", bars = layout[key], locked = !!layout.builtin;
  const patch = (c: Partial<Layout>) => setLayouts((all) => all.map((l) => (l.id === cur ? { ...l, ...c } : l)));
  const setBars = (b: Bar[]) => patch({ [key]: b });
  const patchBar = (id: string, c: Partial<Bar>) => setBars(bars.map((b) => (b.id === id ? { ...b, ...c } : b)));
  const patchItem = (ctl: Ctl, c: Partial<Item>) => setBars(bars.map((b) => ({ ...b, items: b.items.map((i) => (i.ctl === ctl ? { ...i, ...c } : i)) })));
  const copy = (from: Layout) => { const id = `l${Date.now()}`; setLayouts([...layouts, { ...from, id, builtin: false, name: `${from.name}, copy` }]); setCur(id); say(`A copy of “${from.name}” to change`); };
  const used = bars.flatMap((b) => b.items.map((i) => i.ctl)), noShutter = !used.includes("shutter");
  const dev = DEVICES.find((d) => d.id === layout.device) ?? DEVICES[2];

  /** Dragging a control: from a bar in the preview or from a list at the right, into any bar of either. A line shows where it lands. */
  const grab = (ctl: Ctl) => (e: PointerEvent) => {
    if (locked || e.button !== 0 || (e.target as HTMLElement).closest("[data-nodrag], .oc-menu-host, input")) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, root = (e.currentTarget as HTMLElement).closest("[data-theme]") ?? document.body;
    let to: { bar: string; index: number } | null = null, on = false;
    const move = (m: PointerEvent) => {
      if (!on && Math.hypot(m.clientX - sx, m.clientY - sy) < 5) return;
      on = true;
      const host = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>("[data-bar]");
      let line: [number, number, number, number] | null = null; to = null;
      if (host) {
        const x = host.dataset.axis === "x", box = host.getBoundingClientRect(), kids = [...host.querySelectorAll<HTMLElement>("[data-ctl]")].filter((k) => k.dataset.ctl !== ctl).map((k) => k.getBoundingClientRect());
        const index = kids.filter((r) => (x ? r.left + r.width / 2 < m.clientX : r.top + r.height / 2 < m.clientY)).length, r = kids[index], last = kids[kids.length - 1];
        const at = r ? (x ? r.left : r.top) - 3 : last ? (x ? last.right : last.bottom) + 2 : (x ? box.left : box.top) + 4;
        to = { bar: host.dataset.bar!, index }; line = x ? [at, box.top + 3, 3, box.height - 6] : [box.left + 3, at, box.width - 6, 3];
      }
      setDrag({ ctl, x: m.clientX, y: m.clientY, line, root });
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); setDrag(null);
      if (!to) return;
      const target = to;
      setLayouts((all) => all.map((l) => { if (l.id !== cur) return l; const item = l[key].flatMap((b) => b.items).find((i) => i.ctl === ctl)!; return { ...l, [key]: l[key].map((b) => { const items = b.items.filter((i) => i.ctl !== ctl); if (b.id === target.bar) items.splice(target.index, 0, item); return { ...b, items }; }) }; }));
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };

  // The preview: the device's screen with the bars around the camera's picture.
  const [w, h] = land ? [dev.h, dev.w] : [dev.w, dev.h], k = Math.min(1, 640 / h, 900 / w);
  const framed = used.some((c) => ["preset", "focals", "fit", "blackout", "reference", "upright"].includes(c));
  const draw = (i: Item, vertical: boolean) => {
    const c = CTL[i.ctl];
    if (i.ctl === "lights" && !hardware) return null;
    let body;
    if (c.kind === "readout") body = <span className={cx("u6-chip", i.ctl === "r-warn" && "is-warn")}>{i.ctl === "r-collection" && <i />}{c.short}</span>;
    else if (i.ctl === "shutter") body = <Shutter />;
    else if (i.ctl === "last") body = <span className="oc-cam__thumb u6-last"><img src={picture(17)} alt="" /></span>;
    else if (c.kind === "strip") {
      const vals = i.ctl === "lenses" ? (layout.opts.lenses === "main" ? ["1×"] : dev.lenses) : ["24", "35", "50", "85"], now = vals[Math.min(1, vals.length - 1)];
      // A carousel is three full-size parts: back, the value, on. Stacked in an upright bar.
      body = i.display === "carousel" ? <span className={cx("u6-carousel", vertical && "is-v")}><CameraButton icon={vertical ? "chevron-up" : "chevron-left"} label={`Previous: ${c.label}`} /><b>{now}</b><CameraButton icon={vertical ? "chevron-down" : "chevron-right"} label={`Next: ${c.label}`} /></span>
        : <span className={cx("u6-strip", vertical && "is-v")}>{vals.map((v) => <CameraButton key={v} label={v} pressed={v === now}>{v}</CameraButton>)}</span>;
    } else body = <span className="u6-ctl"><CameraButton icon={c.icon} label={c.label} pressed={i.ctl === "blackout"} />{i.label && <small>{c.short}</small>}</span>;
    return <span key={i.ctl} data-ctl={i.ctl} className={cx("u6-slot", drag?.ctl === i.ctl && "is-dragged")} title={locked ? c.label : `${c.label}: drag to move it`} onPointerDown={grab(i.ctl)}>{body}</span>;
  };
  const drawBar = (b: Bar) => <div key={b.id} data-bar={b.id} data-axis={upright(b.edge) ? "y" : "x"} className={cx("u6-bar", b.over && "is-over", upright(b.edge) ? "is-v" : "is-h", `is-${b.dist}`, b.items.some((i) => i.ctl === "shutter") && "has-shutter")}>{b.items.map((i) => draw(i, upright(b.edge)))}{!b.items.length && <small className="u6-bar__empty">{b.name}</small>}</div>;
  const at = (e: Edge) => bars.filter((b) => b.edge === e && !b.over).map(drawBar);
  /** Bars that lie over the picture, stacked at their edge inside it. */
  const over = EDGES.map(([e]) => { const mine = bars.filter((b) => b.edge === e && b.over); return mine.length > 0 && <div key={e} className={cx("u6-over", `u6-over--${e}`)}>{mine.map(drawBar)}</div>; });
  const view = (
    <div className="oc-cam__view">
      <img className="u6-live" src={picture(12)} alt="" />
      {framed && <span className="u6-frame" style={{ borderColor: css(layout.look.color), borderWidth: layout.look.width, boxShadow: used.includes("blackout") ? `0 0 0 2000px color-mix(in srgb, ${layout.look.tint} ${layout.look.dim}%, transparent)` : undefined }} />}
      {over}
    </div>
  );
  // Upright, top and bottom bars take the full width and the side bars what is left between them; in landscape it is the other way round.
  const preview = (
    <div className="u6-device" style={{ width: w * k, height: h * k }}>
      <div className={cx("u6-screen", land && "is-land")} style={{ width: w, height: h, scale: String(k) }}>
        {land ? <>{at("left")}<div className="u6-mid">{at("top")}{view}{at("bottom")}</div>{at("right")}</> : <>{at("top")}<div className="u6-mid">{at("left")}{view}{at("right")}</div>{at("bottom")}</>}
        <div className={cx("u6-tabs", land && "is-side")}>{(["camera", "image", "slate", "settings"] as IconName[]).map((n) => <Icon key={n} name={n} size={20} />)}</div>
      </div>
    </div>
  );

  const barSection = (b: Bar) => (
    <PropertySection key={b.id} title={`${b.name} · ${EDGES.find(([e]) => e === b.edge)![1].toLowerCase()}${b.over ? ", over the picture" : ""} · ${b.items.length}`} icon={upright(b.edge) ? "columns" : "rows"}>
      <PropertyRow label="Name"><TextInput size="sm" value={b.name} disabled={locked} onInput={(e) => patchBar(b.id, { name: (e.target as HTMLInputElement).value })} /></PropertyRow>
      <PropertyRow label="Edge"><Segmented label={`Edge of ${b.name}`} value={b.edge} disabled={locked} onChange={(v) => patchBar(b.id, { edge: v as Edge })} options={EDGES.map(([value, label]) => ({ value, label }))} /></PropertyRow>
      <div className="u6-pad"><Switch checked={!!b.over} disabled={locked} onChange={(v) => patchBar(b.id, { over: v })}>Over the picture: takes no room from it</Switch></div>
      <PropertyRow label="Controls"><Select size="sm" value={b.dist} onChange={(v) => !locked && patchBar(b.id, { dist: v as Dist })} options={DISTS.map(([value, label, hint]) => ({ value, label: `${label}: ${hint.toLowerCase()}` }))} /></PropertyRow>
      <ul className="u6-items" data-bar={b.id} data-axis="y">
        {b.items.map((i) => { const c = CTL[i.ctl], off = i.ctl === "lights" && !hardware; return (
          <li key={i.ctl} data-ctl={i.ctl} className={cx("u6-item", off && "is-off", drag?.ctl === i.ctl && "is-dragged")} onPointerDown={grab(i.ctl)}>
            <Icon name="grip" size={12} /><Icon name={c.icon} /><span className="u6-item__name">{c.label}{off && <small>needs the Hardware extension</small>}</span>
            {c.kind === "strip" ? <span data-nodrag><Segmented label="Shown as" value={i.display ?? "list"} disabled={locked} onChange={(v) => patchItem(i.ctl, { display: v as "list" | "carousel" })} options={[{ value: "list", label: "All" }, { value: "carousel", label: "Stepped" }]} /></span>
              : i.ctl !== "shutter" && i.ctl !== "last" && c.kind !== "readout" && <span data-nodrag><Checkbox checked={!!i.label} disabled={locked} onChange={(v) => patchItem(i.ctl, { label: v })}>Label</Checkbox></span>}
            <Button size="sm" variant="quiet" icon="close" label={i.ctl === "shutter" ? "The shutter cannot be removed" : `Remove ${c.label}`} disabled={locked || i.ctl === "shutter"} data-nodrag onClick={() => patchBar(b.id, { items: b.items.filter((y) => y.ctl !== i.ctl) })} />
          </li>
        ); })}
        {!b.items.length && <li className="u6-item u6-item--empty">Drop a control here</li>}
      </ul>
      <div className="u6-pad u3-bar">
        <DropdownMenu size="sm" variant="quiet" icon="plus" label="Add a control" items={(Object.keys(CTL) as Ctl[]).filter((c) => !used.includes(c)).map((c) => ({ id: c, label: CTL[c].label, icon: CTL[c].icon, disabled: locked || (!!CTL[c].ext && !hardware) }))} onSelect={(c) => patchBar(b.id, { items: [...b.items, { ctl: c as Ctl }] })} />
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="quiet" icon="trash" disabled={locked || b.items.some((i) => i.ctl === "shutter")} title={b.items.some((i) => i.ctl === "shutter") ? "Move the shutter to another bar first" : "Remove this bar and the controls on it"} onClick={() => setBars(bars.filter((x) => x.id !== b.id))}>Remove the bar</Button>
      </div>
    </PropertySection>
  );
  const dockPanels: DockPanel[] = [
    { id: "list", title: "Layouts", icon: "camera-layout", actions: <Button size="sm" icon="plus" onClick={() => copy(START[1])}>New layout</Button>, body: (
      <><List>{layouts.map((l) => <ListRow key={l.id} size="lg" icon={l.builtin ? "lock" : "camera-layout"} selected={l.id === cur} meta={l.builtin ? "Built in" : DEVICES.find((d) => d.id === l.device)?.name} onClick={() => setCur(l.id)}>{l.name}</ListRow>)}</List><p className="u6-note">Layouts belong to your account and follow you into every project. The built-in ones are always there to go back to: duplicate one to change it.</p></>
    ) },
    { id: "bars", title: `Bars · ${bars.length}`, icon: "rows", actions: <DropdownMenu size="sm" icon="plus" label="Bar" items={EDGES.map(([e, l]) => ({ id: e, label: `At the ${l.toLowerCase()}`, disabled: locked }))} onSelect={(e) => { const n = Math.max(0, ...bars.map((b) => Number(b.id.slice(1)) || 0)) + 1; setBars([...bars, bar(`b${n}`, e as Edge, "center", [])]); }} />, body: (
      <PropertyList key={cur + key}>{bars.map(barSection)}<p className="u6-note">Any number of bars at any edge; bars at one edge stack in the order listed. {land ? "In landscape the left and right bars take the full height, and top and bottom bars the width left between them." : "Upright, the top and bottom bars take the full width, and left and right bars the height left between them."} A bar can lie over the picture instead of taking room from it. Drag a control to another place here or in the preview. Each control at most once per orientation.</p></PropertyList>
    ) },
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
        <p className="u6-note">Readouts are controls: add them to any bar in the Bars panel. They start in a bar that lies over the picture.</p>
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
      <Dock panels={dockPanels} layout={panels} onLayoutChange={setPanels} zoneSizes={{ left: 240, right: 400 }}>
        <div className="u6-stage">
          {locked && <Banner tone="info" action={<Button size="sm" onClick={() => copy(layout)}>Duplicate to change</Button>}>A built-in layout cannot be changed.</Banner>}
          {noShutter && <Banner tone="warning">A layout needs the shutter in this orientation. It is not saved until it has one.</Banner>}
          {preview}
          <p className="u6-note">{phone === "preview" ? "The connected phone shows this layout as you change it." : phone === "connected" ? "Click the pill above to preview on the phone." : "Without a phone the preview here is all there is."} Drawn for {dev.name}.{!locked && " Drag a control in the picture to move it."}</p>
        </div>
      </Dock>
      {drag && createPortal(<>{drag.line && <i className="u6-line" style={{ left: drag.line[0], top: drag.line[1], width: drag.line[2], height: drag.line[3] }} />}<div className="oc-dock__ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}><Icon name={CTL[drag.ctl].icon} />{CTL[drag.ctl].label}</div></>, drag.root)}
    </div>
  );
}
