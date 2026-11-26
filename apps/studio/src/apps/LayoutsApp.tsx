// The Camera layouts app (docs/features/camera-layouts.md, docs/rewrite/ux-6-devices.md): the layouts of the account,
// the built-in Camera and Viewfinder (read-only, duplicated to change), and the editor. The middle draws the camera
// as the device the layout is designed for would: its camera's area, its real lenses, the bars around the picture
// or over it. Controls are dragged within a bar and across bars, in the preview and in the Bars panel. A connected
// phone can show the layout live while it is changed (the phone link's `layout` channel).
import "../layouts/layouts.css";
import { createPortal } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  Banner, Badge, Button, CameraButton, Checkbox, Dock, DropdownMenu, Icon, List, ListRow, PropertyList, PropertyRow, PropertySection, Segmented, Select, Shutter, Spinner, Switch, TextInput, Toolbar, ToolbarSpacer,
  cx, useDockLayout, type DockPanel, type IconName,
} from "@openclapper/design";
import {
  BLACKOUT_TINTS, BUILTIN_LAYOUTS, CONTROLS, FRAME_COLOURS, FRAME_WIDTHS, REFERENCE_STEPS, copyLayout, isBuiltinLayout, layoutError, unplaced,
  focalsOf, type Bar, type ControlId, type Distribution, type Edge, type LayoutBody, type LayoutItem,
} from "@openclapper/model";
import { presetsIn } from "../optics";
import * as api from "../api";
import type { FileRec } from "../api";
import * as store from "../files";
import { confirm, contextMenu, toastError } from "../hosts";
import { sendLink, usePhoneLink } from "../phoneLink";
import { activeExtensions, extensionOn, type AppProps } from "./registry";

const EDGES: [Edge, string][] = [["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]];
const DISTS: [Distribution, string][] = [["start", "Packed at the start"], ["center", "Packed in the middle"], ["end", "Packed at the end"], ["between", "Spread out, first and last at the ends"], ["around", "Spread out with room at the ends"]];
const SAVE_AFTER_MS = 600;
/** A phone of the usual size, for a layout designed for no device (or one that did not report its camera). */
const GENERIC = { portrait: { w: 412, h: 760 }, landscape: { w: 860, h: 380 } };
const SAMPLE_FOCALS = ["24", "35", "50", "85"];
const sideways = (e: Edge) => e === "left" || e === "right";
interface DeviceBody { lenses?: { id: string; name: string; focal35: number | null; main?: boolean }[]; camera?: { portrait: { w: number; h: number }; landscape: { w: number; h: number } } | null; screen?: { portrait: { w: number; h: number }; landscape: { w: number; h: number } } | null; layout?: string }

/**
 * How the preview is looked at (orientation, as which device, with which preset, the grid): kept while the Studio
 * is open, across layouts and closing the editor (#426), not saved; previewing only, never part of a layout.
 */
const kept = { land: false, asDevice: "", withPreset: "", grid: false };
function useKept<K extends keyof typeof kept>(k: K): [(typeof kept)[K], (v: (typeof kept)[K]) => void] {
  const [v, setV] = useState(kept[k]);
  return [v, (next) => { kept[k] = next; setV(next); }];
}

export function LayoutsApp({ win, projectId, setTitle, setRoute }: AppProps) {
  const { files } = store.useRoot("home");
  const [cur, setCur] = useState<string>(() => win.resource?.id ?? "viewfinder");
  useEffect(() => { setTitle("Camera layouts"); setRoute(cur); }, [cur]);
  if (!files) return <div className="oc-app st-center"><Spinner /></div>;
  const layouts = files.filter((f) => f.type === "layout").sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  // Phones and tablets only: the hardware extension's lights and transmitters are device files too, without a camera (#426).
  const devices = files.filter((f) => f.type === "device" && ["phone", "tablet"].includes(String((f.body as { kind?: unknown }).kind)));
  const file = isBuiltinLayout(cur) ? null : layouts.find((l) => l.id === cur) ?? null;
  const id = isBuiltinLayout(cur) || file ? cur : "viewfinder";
  return <Editor key={id} id={id} file={file} layouts={layouts} devices={devices} onPick={setCur} projectId={projectId} />;
}

function Editor({ id, file, layouts, devices, onPick, projectId }: { id: string; file: FileRec | null; layouts: FileRec[]; devices: FileRec[]; onPick: (id: string) => void; projectId: string }) {
  const builtin = isBuiltinLayout(id) ? BUILTIN_LAYOUTS[id] : null;
  const locked = !!builtin;
  const [body, setBody] = useState<LayoutBody>(() => (builtin ? copyLayout(builtin.body) : (file!.body as unknown as LayoutBody)));
  const [name, setName] = useState(builtin?.name ?? file!.name);
  const [land, setLand] = useKept("land");
  const [status, setStatus] = useState<"saved" | "waiting" | "invalid">("saved");
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(body);
  latest.current = body;
  const key = land ? "landscape" : "portrait";
  const bars = body[key].bars;
  const wrong = layoutError(body as unknown as Record<string, unknown>);
  const link = usePhoneLink();
  const [panels, setPanels, resetPanels] = useDockLayout("layouts", { left: { tabs: ["list"] }, right: { tabs: ["bars", "look", "options"] } });

  // Saved a moment after the last change, and only once it is valid (a layout without its shutter is not).
  const save = async () => {
    pending.current = null;
    if (!file || layoutError(latest.current as unknown as Record<string, unknown>)) return;
    try { await api.putFile(file.id, { body: latest.current }); setStatus("saved"); void store.loadRoot("home"); }
    catch (e) { toastError(e); }
  };
  useEffect(() => () => { if (pending.current) { clearTimeout(pending.current); void save(); } }, []);
  const change = (next: LayoutBody) => {
    if (locked) return;
    latest.current = next; setBody(next);
    setStatus(layoutError(next as unknown as Record<string, unknown>) ? "invalid" : "waiting");
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => void save(), SAVE_AFTER_MS);
  };
  const setBars = (b: Bar[]) => change({ ...latest.current, [key]: { bars: b } });
  const patchBar = (bid: string, c: Partial<Bar>) => setBars(bars.map((b) => (b.id === bid ? { ...b, ...c } : b)));
  const patchItem = (ctl: ControlId, c: Partial<LayoutItem>) => setBars(bars.map((b) => ({ ...b, items: b.items.map((i) => (i.control === ctl ? { ...i, ...c } : i)) })));
  const rename = () => { const to = name.trim(); if (!file || !to || to === file.name) { setName(file?.name ?? name); return; } void store.rename(file, to).catch(toastError); };

  // The live preview: while the Studio previews, every change goes to the phone.
  const [previewing, setPreviewing] = useState(false);
  const phone = link.phones[0];
  // For previewing only, never part of the layout (#426): which device's camera and lenses, which optics preset's
  // focal lengths, and the grid that outlines every bar (also on the device's live preview).
  const [asDevice, setAsDevice] = useKept("asDevice");
  const [withPreset, setWithPreset] = useKept("withPreset");
  const [grid, setGrid] = useKept("grid");
  const preview = () => sendLink({ ch: "layout", type: "preview", layout: latest.current, orientation: key, device: body.device, grid });
  useEffect(() => { if (!link.previewing && previewing) setPreviewing(false); }, [link.previewing]);
  useEffect(() => { if (previewing && !wrong) preview(); }, [previewing, body, key, grid]);
  useEffect(() => () => { if (previewing) sendLink({ ch: "layout", type: "stop" }); }, [previewing]);
  const pillState = !link.open || !link.phones.length ? "none" : previewing ? "preview" : "connected";

  const duplicate = async (from: LayoutBody, fromName: string) => {
    try {
      const nid = crypto.randomUUID();
      await store.create("home", "layout", { id: nid, name: `${fromName}, copy`.slice(0, 120), body: copyLayout(from) as unknown as Record<string, unknown> });
      onPick(nid);
    } catch (e) { toastError(e); }
  };
  const remove = async () => {
    if (!file || !(await confirm({ danger: true, title: `Delete “${file.name}”?`, message: "Devices that use it switch to the Viewfinder. It goes to the recycle bin.", confirmLabel: "Delete" }))) return;
    try { await store.bin("home", [file.id]); onPick("viewfinder"); } catch (e) { toastError(e); }
  };

  // ---------- Dragging a control: from a bar in the preview or a row of the Bars panel, into any bar ----------
  const [drag, setDrag] = useState<{ ctl: ControlId; x: number; y: number; line: [number, number, number, number] | null } | null>(null);
  const grab = (ctl: ControlId) => (e: PointerEvent) => {
    if (locked || e.button !== 0 || (e.target as HTMLElement).closest("[data-nodrag], .oc-menu-host, input, select")) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let to: { bar: string; index: number } | null = null, on = false;
    const move = (m: PointerEvent) => {
      if (!on && Math.hypot(m.clientX - sx, m.clientY - sy) < 5) return;
      on = true;
      const host = document.elementFromPoint(m.clientX, m.clientY)?.closest<HTMLElement>("[data-bar]");
      let line: [number, number, number, number] | null = null; to = null;
      if (host) {
        const x = host.dataset.axis === "x", box = host.getBoundingClientRect();
        const kids = [...host.querySelectorAll<HTMLElement>("[data-ctl]")].filter((k) => k.dataset.ctl !== ctl).map((k) => k.getBoundingClientRect());
        const index = kids.filter((r) => (x ? r.left + r.width / 2 < m.clientX : r.top + r.height / 2 < m.clientY)).length, r = kids[index], last = kids[kids.length - 1];
        const at = r ? (x ? r.left : r.top) - 3 : last ? (x ? last.right : last.bottom) + 2 : (x ? box.left : box.top) + 4;
        to = { bar: host.dataset.bar!, index };
        line = x ? [at, box.top + 3, 3, box.height - 6] : [box.left + 3, at, box.width - 6, 3];
      }
      setDrag({ ctl, x: m.clientX, y: m.clientY, line });
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); setDrag(null);
      if (!to) return;
      const target = to, all = latest.current[key].bars, it = all.flatMap((b) => b.items).find((i) => i.control === ctl);
      if (!it) return;
      setBars(all.map((b) => { const items = b.items.filter((i) => i.control !== ctl); if (b.id === target.bar) items.splice(target.index, 0, it); return { ...b, items }; }));
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };

  // ---------- The preview: the device's camera with the bars around the picture ----------
  // The device shown: the one picked for the preview, else the one showing the live preview, else the one the layout is designed for.
  const dev = devices.find((d) => d.id === (asDevice || (previewing ? phone?.id : null) || body.device));
  const project = store.useRoot({ project: projectId });
  const presets = presetsIn(project.files ?? []);
  const preset = presets.find((p) => p.id === withPreset);
  const db = (dev?.body ?? {}) as DeviceBody;
  const area = db.camera ?? db.screen ?? GENERIC;
  const { w, h } = land ? area.landscape : area.portrait;
  const k = Math.min(1, 620 / h, 860 / w);
  const placed = bars.flatMap((b) => b.items.map((i) => i.control));
  const lensNames = (body.options.lensNames === "account" ? "phone" : body.options.lensNames);
  const devLenses = db.lenses?.length ? db.lenses.filter((l) => !(l as { off?: boolean }).off) : [{ id: "w", name: "0.5×", focal35: 13 }, { id: "m", name: "1×", focal35: 24, main: true }, { id: "t", name: "5×", focal35: 120 }];
  const lenses = (body.options.lenses.mode === "main" ? devLenses.filter((l) => l.main ?? l.name === "1×").slice(0, 1) : body.options.lenses.mode === "pick" ? devLenses.filter((l) => body.options.lenses.pick.includes(l.id)) : devLenses)
    .map((l) => (lensNames === "focal" && l.focal35 ? String(Math.round(l.focal35)) : l.name));
  const framed = placed.some((c) => ["frame", "focal", "fit", "blackout", "reference", "upright"].includes(c));
  const sample: Record<string, string> = { "read-project": "Stock demo", "read-lens": lensNames === "focal" ? "24 mm" : "1×", "read-frame": "Alexa 35 · 35 mm", "read-fov": "54° × 38°", "read-collection": "Collection 3 · 4", "read-folder": "Top level", "read-warnings": "Frame wider than the lens" };
  const draw = (i: LayoutItem, vertical: boolean) => {
    const c = CONTROLS[i.control];
    let el;
    if (c.kind === "readout") el = <span className={cx("lay-tag", i.control === "read-warnings" && "is-warn")}>{sample[i.control]}</span>;
    else if (c.kind === "shutter") el = <Shutter />;
    else if (i.control === "last") el = <span className="lay-last"><Icon name="image" size={20} /></span>;
    else if (c.kind === "strip") {
      const focals = preset ? focalsOf(preset.body.lenses).map(String) : SAMPLE_FOCALS;
      const vals = i.control === "lenses" ? lenses : focals, now = vals[Math.min(1, vals.length - 1)] ?? "–";
      // A zoom preset: the slider the device shows for it, whatever the item's display (#426).
      const zoom = i.control === "focal" && preset?.body.lenses.kind === "zoom" ? preset.body.lenses : null;
      // Stepped: three full-size parts a thumb can hit, back, the value, on; stacked in an upright bar.
      el = zoom
        ? <span className={cx("lay-zoom", vertical && "is-v")}><CameraButton icon={vertical ? "plus" : "minus"} label={vertical ? "Longer focal length" : "Shorter focal length"} /><span className="lay-zoom__track"><i style={{ [vertical ? "bottom" : "left"]: "30%" }} /></span><CameraButton icon={vertical ? "minus" : "plus"} label={vertical ? "Shorter focal length" : "Longer focal length"} /><b>{Math.round(zoom.from + (zoom.to - zoom.from) * 0.3)} mm</b></span>
        : i.display === "stepped"
        ? <span className={cx("lay-step", vertical && "is-v")}><CameraButton icon={vertical ? "chevron-up" : "chevron-left"} label={`Previous: ${c.label}`} /><b>{now}</b><CameraButton icon={vertical ? "chevron-down" : "chevron-right"} label={`Next: ${c.label}`} /></span>
        : <span className={cx("lay-strip", vertical && "is-v")}>{vals.map((v) => <CameraButton key={v} label={v} pressed={v === now}>{v}</CameraButton>)}</span>;
    } else el = <span className="lay-ctl"><CameraButton icon={c.icon as IconName} label={c.label} pressed={i.control === "blackout" && body.look.blackoutOn} />{i.label && "short" in c && <small>{c.short}</small>}</span>;
    // An extension's control while the project has it off: kept in the layout, greyed here, left out on the phone.
    const off = !extensionOn(c.extension);
    return <span key={i.control} data-ctl={i.control} className={cx("lay-slot", drag?.ctl === i.control && "is-dragged", off && "is-off")} title={off ? `${c.label}: needs its extension, left out on the phone` : locked ? c.label : `${c.label}: drag to move it, click to find it in Bars, right-click to remove it`}
      onPointerDown={grab(i.control)} onClick={() => findInBars(i.control)} onContextMenu={(e) => controlMenu(e, i.control)}>{el}</span>;
  };
  const drawBar = (b: Bar) => (
    <div key={b.id} data-bar={b.id} data-axis={sideways(b.edge) ? "y" : "x"} className={cx("lay-bar", b.over && "is-over", sideways(b.edge) ? "is-v" : "is-h", `is-${b.distribution}`, b.items.some((i) => i.control === "shutter") && "has-shutter")}>
      {b.items.map((i) => draw(i, sideways(b.edge)))}{!b.items.length && <small className="lay-bar__empty">{b.name}</small>}
    </div>
  );
  /** A click on a control in the preview: its entry in Bars scrolls into view and flashes (#426). */
  const panelRef = useRef<HTMLDivElement>(null);
  const findInBars = (ctl: ControlId) => {
    const li = panelRef.current?.closest(".oc-app")?.querySelector<HTMLElement>(`.lay-items [data-ctl="${ctl}"]`);
    if (!li) return;
    li.scrollIntoView({ block: "center", behavior: "smooth" });
    li.classList.remove("is-flash");
    void li.offsetWidth;
    li.classList.add("is-flash");
  };
  /** Right-click on a control in the preview: remove it, or find it in Bars (#426). */
  const controlMenu = (e: MouseEvent, ctl: ControlId) => {
    e.preventDefault();
    const bar = bars.find((b) => b.items.some((i) => i.control === ctl));
    contextMenu(e, [
      { heading: CONTROLS[ctl].label },
      { id: "find", label: "Show in Bars", icon: "search", run: () => findInBars(ctl) },
      { id: "remove", label: ctl === "shutter" ? "The shutter cannot be removed" : "Remove", icon: "trash", danger: true, disabled: locked || ctl === "shutter" || !bar, run: () => bar && patchBar(bar.id, { items: bar.items.filter((y) => y.control !== ctl) }) },
    ]);
  };
  const at = (e: Edge) => bars.filter((b) => b.edge === e && !b.over).map(drawBar);
  const over = EDGES.map(([e]) => { const mine = bars.filter((b) => b.edge === e && b.over); return mine.length > 0 && <div key={e} className={cx("lay-over", `lay-over--${e}`)}>{mine.map(drawBar)}</div>; });
  const view = (
    <div className="lay-view">
      <span className="lay-live" />
      {framed && <span className="lay-frame" style={{ borderColor: body.look.frameColor, borderWidth: body.look.frameWidth, boxShadow: body.look.blackoutOn || placed.includes("blackout") ? `0 0 0 2000px ${body.look.blackoutColor}` : undefined }} />}
      {over}
    </div>
  );
  // Upright, top and bottom bars take the full width and the side bars the height left between them; in landscape the other way round.
  const shown = (
    <div className="lay-device" style={{ width: w * k + 16, height: h * k + 16 }}>
      <div ref={panelRef} className={cx("lay-screen", land && "is-land", grid && "is-grid")} style={{ width: w, height: h, scale: String(k) }}>
        {land ? <>{at("left")}<div className="lay-mid">{at("top")}{view}{at("bottom")}</div>{at("right")}</> : <>{at("top")}<div className="lay-mid">{at("left")}{view}{at("right")}</div>{at("bottom")}</>}
      </div>
    </div>
  );

  // ---------- Panels ----------
  const barSection = (b: Bar) => (
    <PropertySection key={b.id} title={`${b.name || "Bar"} · ${EDGES.find(([e]) => e === b.edge)![1].toLowerCase()}${b.over ? ", over the picture" : ""} · ${b.items.length}`} icon={sideways(b.edge) ? "columns" : "rows"}>
      <PropertyRow label="Name"><TextInput size="sm" value={b.name} disabled={locked} maxLength={40} onInput={(e) => patchBar(b.id, { name: e.currentTarget.value })} /></PropertyRow>
      <PropertyRow label="Edge"><Segmented label={`Edge of ${b.name}`} value={b.edge} disabled={locked} onChange={(v) => patchBar(b.id, { edge: v as Edge })} options={EDGES.map(([value, label]) => ({ value, label }))} /></PropertyRow>
      <div className="lay-pad"><Switch checked={b.over} disabled={locked} onChange={(v) => patchBar(b.id, { over: v })}>Over the picture: takes no room from it</Switch></div>
      <PropertyRow label="Controls"><Select size="sm" value={b.distribution} disabled={locked} onChange={(v) => patchBar(b.id, { distribution: v as Distribution })} options={DISTS.map(([value, label]) => ({ value, label }))} /></PropertyRow>
      <ul className="lay-items" data-bar={b.id} data-axis="y">
        {b.items.map((i) => { const c = CONTROLS[i.control]; return (
          <li key={i.control} data-ctl={i.control} className={cx("lay-item", drag?.ctl === i.control && "is-dragged")} onPointerDown={grab(i.control)}>
            <Icon name="grip" size={12} /><Icon name={c.icon as IconName} /><span className="lay-item__name">{c.label}{!extensionOn(c.extension) && <small> · needs its extension</small>}</span>
            {c.kind === "strip" && <span data-nodrag><Segmented label="Shown as" value={i.display ?? "list"} disabled={locked} onChange={(v) => patchItem(i.control, { display: v as "list" | "stepped" })} options={[{ value: "list", label: "All" }, { value: "stepped", label: "Stepped" }]} /></span>}
            {i.control === "lenses" && <span data-nodrag><Segmented label="Length" value={i.size ?? "fit"} disabled={locked} onChange={(v) => patchItem(i.control, { size: v as "fill" | "fit" })} options={[{ value: "fit", label: "Fit" }, { value: "fill", label: "Fill" }]} /></span>}
            {c.kind === "button" && <span data-nodrag><Checkbox checked={!!i.label} disabled={locked} onChange={(v) => patchItem(i.control, { label: v || undefined })}>Label</Checkbox></span>}
            <Button size="sm" variant="quiet" icon="close" label={i.control === "shutter" ? "The shutter cannot be removed" : `Remove ${c.label}`} disabled={locked || i.control === "shutter"} data-nodrag onClick={() => patchBar(b.id, { items: b.items.filter((y) => y.control !== i.control) })} />
          </li>
        ); })}
        {!b.items.length && <li className="lay-item lay-item--empty">Drop a control here</li>}
      </ul>
      <div className="lay-pad lay-row">
        <DropdownMenu size="sm" variant="quiet" icon="plus" label="Add a control" items={unplaced(body[key], activeExtensions()).map((c) => ({ id: c, label: CONTROLS[c].label, icon: CONTROLS[c].icon as IconName, disabled: locked }))} onSelect={(c) => patchBar(b.id, { items: [...b.items, { control: c as ControlId }] })} />
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="quiet" icon="trash" disabled={locked || b.items.some((i) => i.control === "shutter")} title={b.items.some((i) => i.control === "shutter") ? "Move the shutter to another bar first" : "Remove this bar and the controls on it"} onClick={() => setBars(bars.filter((x) => x.id !== b.id))}>Remove the bar</Button>
      </div>
    </PropertySection>
  );
  const addBar = (e: Edge) => { const n = Math.max(0, ...bars.map((b) => Number(b.id.replace(/\D/g, "")) || 0)) + 1; setBars([...bars, { id: `b${n}`, name: `Bar ${n}`, edge: e, over: false, distribution: "center", items: [] }]); };
  const look = body.look, opts = body.options;
  const dockPanels: DockPanel[] = [
    { id: "list", title: "Layouts", icon: "camera-layout", actions: <div className="lay-pad lay-row"><Button size="sm" icon="plus" onClick={() => void duplicate(BUILTIN_LAYOUTS.viewfinder.body, "Viewfinder")}>New layout</Button></div>, body: (
      <>
        <List>
          {(["camera", "viewfinder"] as const).map((b) => <ListRow key={b} size="lg" icon="lock" selected={id === b} meta="Built in" onClick={() => onPick(b)}>{BUILTIN_LAYOUTS[b].name}</ListRow>)}
          {layouts.map((l) => <ListRow key={l.id} size="lg" icon="camera-layout" selected={id === l.id} meta={devices.find((d) => d.id === (l.body as unknown as LayoutBody | undefined)?.device)?.name ?? "Any device"} onClick={() => onPick(l.id)}>{l.name}</ListRow>)}
        </List>
        <p className="lay-note">Layouts belong to your account and follow you into every project. The built-in ones are always there to go back to: duplicate one to change it. A device chooses its layout on the phone or in Devices.</p>
      </>
    ) },
    { id: "bars", title: `Bars · ${bars.length}`, icon: "rows", actions: <div className="lay-pad lay-row"><DropdownMenu size="sm" icon="plus" label="Bar" items={EDGES.map(([e, l]) => ({ id: e, label: `At the ${l.toLowerCase()}`, disabled: locked }))} onSelect={(e) => addBar(e as Edge)} /></div>, body: (
      <PropertyList key={id + key}>
        {bars.map(barSection)}
        <p className="lay-note">Any number of bars at any edge; bars at one edge stack in the order listed. {land ? "In landscape the left and right bars take the full height, and top and bottom bars the width left between them." : "Upright, the top and bottom bars take the full width, and left and right bars the height left between them."} A bar can lie over the picture. Drag a control to another place here or in the preview. Each control at most once per orientation; the shutter in each.</p>
      </PropertyList>
    ) },
    { id: "look", title: "Look", icon: "palette", body: (
      <PropertyList key={id + "look"}>
        <PropertySection title="The frame" icon="frame">
          <PropertyRow label="Colour"><span className="lay-swatches">{FRAME_COLOURS.map(([n, c]) => <button type="button" key={c} title={n} disabled={locked} className={cx(look.frameColor.toLowerCase() === c && "is-on")} style={{ background: c }} onClick={() => change({ ...body, look: { ...look, frameColor: c } })} />)}</span></PropertyRow>
          <PropertyRow label="Width"><Segmented label="Frame width" value={String(look.frameWidth)} disabled={locked} onChange={(v) => change({ ...body, look: { ...look, frameWidth: Number(v) } })} options={FRAME_WIDTHS.map((x) => ({ value: String(x), label: `${x}` }))} /></PropertyRow>
        </PropertySection>
        <PropertySection title="Blackout" icon="contrast">
          <PropertyRow label="Tint"><Select size="sm" value={look.blackoutColor} disabled={locked} onChange={(v) => change({ ...body, look: { ...look, blackoutColor: v } })} options={BLACKOUT_TINTS.map(([n, c]) => ({ value: c, label: n }))} /></PropertyRow>
          <div className="lay-pad"><Switch checked={look.blackoutOn} disabled={locked} onChange={(v) => change({ ...body, look: { ...look, blackoutOn: v } })}>On when the camera opens</Switch></div>
        </PropertySection>
        <p className="lay-note">Readouts are controls: add them to any bar in the Bars panel. The built-in layouts keep them in a bar over the picture.</p>
      </PropertyList>
    ) },
    { id: "options", title: "Options", icon: "sliders", body: (
      <PropertyList key={id + "opts"}>
        <PropertySection title="Designed for" icon="mobile">
          <PropertyRow label="Device"><Select size="sm" value={body.device ?? ""} disabled={locked} onChange={(v) => change({ ...body, device: v || null })} options={[{ value: "", label: "Any device (a usual phone)" }, ...devices.map((d) => ({ value: d.id, label: d.name }))]} /></PropertyRow>
          <p className="lay-note">The preview uses this device's camera area and its real lenses, as it reported them. On another device the layout is laid out for that one.</p>
        </PropertySection>
        <PropertySection title="Controls" icon="sliders">
          <PropertyRow label="Reference frame"><Select size="sm" value={opts.reference.mode === "cycle" ? "cycle" : String(opts.reference.mm)} disabled={locked} onChange={(v) => change({ ...body, options: { ...opts, reference: v === "cycle" ? { mode: "cycle", mm: opts.reference.mm } : { mode: "toggle", mm: Number(v) } } })}
            options={[{ value: "cycle", label: "Steps through 35, 43, 50 mm" }, ...REFERENCE_STEPS.map((mm) => ({ value: String(mm), label: `On / off at ${mm} mm` }))]} /></PropertyRow>
          <PropertyRow label="Phone lenses"><Select size="sm" value={opts.lenses.mode} disabled={locked} onChange={(v) => change({ ...body, options: { ...opts, lenses: { mode: v as "all" | "main" | "pick", pick: opts.lenses.pick } } })} options={[{ value: "all", label: "Every real lens" }, { value: "main", label: "The main lens only" }, { value: "pick", label: "Those picked" }]} /></PropertyRow>
          {opts.lenses.mode === "pick" && <div className="lay-pad lay-row">{devLenses.map((l) => <Checkbox key={l.id} checked={opts.lenses.pick.includes(l.id)} disabled={locked} onChange={(c) => change({ ...body, options: { ...opts, lenses: { mode: "pick", pick: c ? [...opts.lenses.pick, l.id] : opts.lenses.pick.filter((x) => x !== l.id) } } })}>{l.name}</Checkbox>)}</div>}
          <PropertyRow label="Lens names"><Select size="sm" value={opts.lensNames} disabled={locked} onChange={(v) => change({ ...body, options: { ...opts, lensNames: v as LayoutBody["options"]["lensNames"] } })} options={[{ value: "account", label: "As set for the account" }, { value: "phone", label: "The phone's names" }, { value: "focal", label: "Focal lengths" }]} /></PropertyRow>
        </PropertySection>
      </PropertyList>
    ) },
  ];
  const pillText = pillState === "none" ? (link.open ? "No device connected" : "Device link offline") : pillState === "connected" ? `${phone?.name || "A device"} connected` : `Previewing on ${phone?.name || "the phone"}`;
  return (
    <div className="oc-app">
      <Toolbar>
        <Icon name="camera-layout" size={20} />
        {locked ? <strong className="st-title">{name}</strong> : <TextInput size="sm" value={name} aria-label="Name" maxLength={120} style={{ width: 200 }} onInput={(e) => setName(e.currentTarget.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />}
        {locked ? <Badge icon="lock">Built in, read-only</Badge> : <span className="lay-saved">{status === "invalid" ? <><Icon name="warning" size={12} />Not saved yet</> : status === "waiting" ? "Changed" : <><Icon name="check" size={12} />Saved</>}</span>}
        <Segmented label="Orientation" value={key} onChange={(v) => setLand(v === "landscape")} options={[{ value: "portrait", label: "Upright" }, { value: "landscape", label: "Landscape" }]} />
        <Select size="sm" aria-label="Preview as a device" value={asDevice} onChange={setAsDevice} title="Whose camera and real lenses the preview shows; for previewing only"
          options={[{ value: "", label: previewing && phone?.id ? `As ${phone.name || "the device"} (live)` : body.device ? `As ${devices.find((d) => d.id === body.device)?.name ?? "its device"}` : "As a usual phone" }, ...devices.filter((d) => d.id !== body.device).map((d) => ({ value: d.id, label: `As ${d.name}` }))]} />
        <Select size="sm" aria-label="Preview with an optics preset" value={withPreset} onChange={setWithPreset} title="Whose focal lengths the focal length control shows; for previewing only"
          options={[{ value: "", label: "Sample focal lengths" }, ...presets.map((p) => ({ value: p.id, label: `With ${p.name}` }))]} />
        <Button size="sm" variant="quiet" icon="grid" selected={grid} onClick={() => setGrid(!grid)} title="Outline every bar, here and on the device's live preview">Grid</Button>
        <ToolbarSpacer />
        <button type="button" className={cx("lay-pill", `is-${pillState}`)} disabled={pillState === "none" || !!wrong} title={pillState === "none" ? "Open the app on a phone signed in to this account" : previewing ? "Stop the preview on the phone" : "Show this layout on the phone while you change it"}
          onClick={() => { if (previewing) { sendLink({ ch: "layout", type: "stop" }); setPreviewing(false); } else setPreviewing(true); }}><i />{pillText}</button>
        <Button size="sm" icon="copy" onClick={() => void duplicate(body, name)}>Duplicate</Button>
        <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "reset", label: "Reset to the Viewfinder", icon: "undo", disabled: locked }, { id: "delete", label: "Delete…", icon: "trash", danger: true, disabled: locked }, { separator: true }, { id: "panels", label: "Panels back to their places", icon: "refresh" }]}
          onSelect={(x) => { if (x === "panels") resetPanels(); else if (x === "reset") change({ ...copyLayout(BUILTIN_LAYOUTS.viewfinder.body), device: body.device }); else void remove(); }} />
      </Toolbar>
      <Dock panels={dockPanels} layout={panels} onLayoutChange={setPanels} zoneSizes={{ left: 240, right: 420 }}>
        <div className="lay-stage">
          {locked && <Banner tone="info" action={<Button size="sm" onClick={() => void duplicate(body, name)}>Duplicate to change</Button>}>A built-in layout cannot be changed.</Banner>}
          {!locked && wrong && <Banner tone="warning">{wrong[0].toUpperCase() + wrong.slice(1)}. It is saved once that is fixed.</Banner>}
          {shown}
          <p className="lay-note">Drawn for {dev?.name ?? "a usual phone"} ({w} × {h}){!db.camera && dev ? ", its whole screen: the camera's area is reported when the app runs" : ""}.{!locked && " Drag a control in the picture to move it."} {pillState === "preview" ? "The phone shows this layout as you change it; nothing is saved on the phone." : ""}</p>
        </div>
      </Dock>
      {drag && createPortal(<>{drag.line && <i className="lay-line" style={{ left: drag.line[0], top: drag.line[1], width: drag.line[2], height: drag.line[3] }} />}<div className="oc-dock__ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}><Icon name={CONTROLS[drag.ctl].icon as IconName} />{CONTROLS[drag.ctl].label}</div></>, document.body)}
    </div>
  );
}

export const layoutsFromRoute = (rest: string) => ({ resource: rest ? { type: "layout", id: rest } : null });

