import { useEffect, useRef, useState } from "preact/hooks";
import { DEFAULT_VIEWFINDER_LAYOUT, unplaced, validateViewfinderLayout, VF_CONTROL_LABELS, VF_SHORT_LABELS, type VfBar, type VfControl, type VfItem, type VfOrientation, type VfOrientationName, type ViewfinderLayout } from "@fielder/vocab";
import { deleteDevice, deleteLayout, fetchDevices, fetchLayouts, putDevice, putLayout, type DeviceRecord, type LayoutRecord } from "./api";
import { DeviceDialog, deviceScreen } from "./DeviceSpecs";
import { usePhonePreview, type PhonePreview } from "./phonePreview";
import { Banner, Button, Checkbox, confirmDialog, cx, Empty, EmptyNote, Icon, IconButton, Input, ListRow, Loading, MenuItem, Panel, PanelBody, PanelHead, Popover, promptDialog, ReorderButtons, SaveStatus, Seg, Select, toast, Toolbar, ToolbarSpacer, ToolbarTitle, type SaveState } from "./ui";

/**
 * Library › Viewfinder (issue #49): layouts for the phone's Shoot screen. Which controls show, in which
 * bars, per orientation; the phone picks one in Setup → Viewfinder. The built-in Default is today's
 * arrangement: it can't be changed, but every layout can be reset to it. The preview follows the
 * phone's sizes (vfLayout.ts there) on a device read out from a real phone (issue #68: its Shoot
 * screen per orientation and its lenses); a layout remembers the device it is designed for.
 * "Preview on phone" (issue #50) shows the layout being edited on the real phone, live, in the
 * orientation picked here.
 */

const DEFAULT_ID = "__default__";
const ADD_DEVICE = "__add__";
/** The Default has no record to remember a device on: this browser does. */
const DEFAULT_DEVICE_KEY = "vfDefaultDevice";
const ICONS: Record<Exclude<VfControl, "shutter" | "lens" | "zoom">, string> = { uploads: "cloud-upload-outline", seq: "layers-triple-outline", light: "flashlight", fit: "fit-to-screen-outline", human: "human-male", rig: "camera-control" };
const clone = (l: ViewfinderLayout): ViewfinderLayout => JSON.parse(JSON.stringify(l)) as ViewfinderLayout;
/** Same sizes as the phone (apps/mobile/src/vfLayout.ts). */
const SZ = { padStart: 10, padEnd: 12, gap: 10, line: 2, row: 56, shutter: 76, column: 80 };

/** Not connected (grey), a phone is there (amber), previewing on it (green). */
function PhoneStatus({ phone }: { phone: PhonePreview }) {
  const model = phone.phones[0]?.model ?? "Phone";
  const [kind, text] = !phone.connected ? ["off", "Offline"] : phone.previewing ? ["live", `Previewing on ${model}`] : phone.phones.length ? ["ready", `${model} connected`] : ["off", "No phone connected"];
  return <span class={cx("vf-status", `vf-status--${kind}`)} role="status"><Icon name={kind === "live" ? "cellphone-play" : kind === "ready" ? "cellphone" : "cellphone-off"} />{text}</span>;
}

export function ViewfinderLayoutsPage({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string | null) => void }) {
  const [list, setList] = useState<LayoutRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const phone = usePhonePreview();
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [dialog, setDialog] = useState<{ then?: (d: DeviceRecord) => void } | null>(null);
  useEffect(() => { fetchLayouts().then(setList).catch((e: Error) => setError(e.message)); }, []);
  useEffect(() => { fetchDevices().then(setDevices).catch((e: Error) => toast(`Could not load the devices: ${e.message}`, "danger")); }, []);
  // A saved phone that sends fresh specs while connected (it measured, recalibrated) shows them at once.
  const live = devices.map((d) => (phone.specs[d.id] ? { ...d, specs: phone.specs[d.id] } : d));
  const deviceCtl: DeviceCtl = {
    devices: live,
    add: (then) => setDialog({ then }),
    rename: async (d) => {
      const name = await promptDialog({ title: "Rename device", input: { label: "Name", value: d.name }, confirmLabel: "Rename" });
      if (!name) return;
      try { const r = await putDevice({ id: d.id, name, specs: d.specs }); setDevices((cur) => cur.map((x) => (x.id === r.id ? r : x))); } catch (e) { toast(`Rename failed: ${(e as Error).message}`, "danger"); }
    },
    remove: async (d) => {
      const ok = await confirmDialog({ title: `Delete “${d.name}”?`, body: "Layouts designed for it keep working and lose the reference. The phone can be read out again any time.", confirmLabel: "Delete device", danger: true });
      if (!ok) return;
      try { await deleteDevice(d.id); setDevices((cur) => cur.filter((x) => x.id !== d.id)); toast("Device deleted"); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
    },
  };
  const sel = selectedId ?? DEFAULT_ID;
  const current = list?.find((l) => l.id === sel) ?? null;

  async function create(from: ViewfinderLayout, name: string) {
    try {
      const saved = await putLayout({ id: crypto.randomUUID(), name, layout: clone(from) });
      setList((cur) => [...(cur ?? []), saved].sort((a, b) => a.name.localeCompare(b.name)));
      onSelect(saved.id);
    } catch (e) { toast(`Could not create the layout: ${(e as Error).message}`, "danger"); }
  }
  async function newLayout(from: ViewfinderLayout, suggested: string) {
    const name = await promptDialog({ title: "New viewfinder layout", input: { label: "Name", value: suggested, placeholder: "e.g. One-handed, left" }, confirmLabel: "Create" });
    if (name) await create(from, name);
  }

  if (error) return <Empty icon="cloud-alert" title="Could not load the layouts">{error}</Empty>;
  if (!list) return <Loading />;
  return (
    <>
      <Toolbar>
        <ToolbarTitle count={list.length + 1}>Viewfinder layouts</ToolbarTitle>
        <span class="meta">The phone picks one in Setup → Viewfinder → Layout.</span>
        <ToolbarSpacer />
        <PhoneStatus phone={phone} />
        <Button size="sm" icon="plus" onClick={() => void newLayout(DEFAULT_VIEWFINDER_LAYOUT, "My layout")}>New layout</Button>
      </Toolbar>
      <div class="f-app__body">
        <Panel left width="240px">
          <PanelBody flush role="listbox" aria-label="Layouts">
            <ListRow role="option" aria-selected={sel === DEFAULT_ID} selected={sel === DEFAULT_ID} onClick={() => onSelect(null)} title="Default" meta="Built in · as the app ships" />
            {list.map((l) => <ListRow key={l.id} role="option" aria-selected={l.id === sel} selected={l.id === sel} onClick={() => onSelect(l.id)} title={l.name} meta={summary(l.layout)} />)}
          </PanelBody>
        </Panel>
        {sel === DEFAULT_ID || !current
          ? <Editor key="default" record={null} phone={phone} devices={deviceCtl} onDuplicate={() => void newLayout(DEFAULT_VIEWFINDER_LAYOUT, "My layout")} />
          : <Editor key={current.id} record={current} phone={phone} devices={deviceCtl} onDuplicate={() => void newLayout(current.layout, `${current.name} (copy)`)}
              onSaved={(r) => setList((cur) => (cur ?? []).map((x) => (x.id === r.id ? r : x)))}
              onDeleted={() => { setList((cur) => (cur ?? []).filter((x) => x.id !== current.id)); onSelect(null); }} />}
      </div>
      {dialog && <DeviceDialog phone={phone} devices={live} onClose={() => setDialog(null)}
        onSaved={(d) => { setDevices((cur) => [...cur.filter((x) => x.id !== d.id), d].sort((a, b) => a.name.localeCompare(b.name))); dialog.then?.(d); setDialog(null); }} />}
    </>
  );
}

interface DeviceCtl {
  devices: DeviceRecord[];
  /** Open Add device specs; `then` gets the saved device. */
  add: (then?: (d: DeviceRecord) => void) => void;
  rename: (d: DeviceRecord) => Promise<void>;
  remove: (d: DeviceRecord) => Promise<void>;
}

const summary = (l: ViewfinderLayout) => `${l.portrait.bars.length} bar${l.portrait.bars.length === 1 ? "" : "s"} portrait · ${l.landscape.bars.length} landscape`;

function Editor({ record, phone, devices, onDuplicate, onSaved, onDeleted }: { record: LayoutRecord | null; phone: PhonePreview; devices: DeviceCtl; onDuplicate: () => void; onSaved?: (r: LayoutRecord) => void; onDeleted?: () => void }) {
  const [layout, setLayout] = useState<ViewfinderLayout>(() => clone(record?.layout ?? DEFAULT_VIEWFINDER_LAYOUT));
  const [name, setName] = useState(record?.name ?? "Default");
  const [orient, setOrient] = useState<VfOrientationName>("portrait");
  // The device this layout is designed for (the Default's is remembered per browser).
  const [deviceId, setDeviceIdState] = useState<string | null>(() => record ? record.device_id : (() => { try { return localStorage.getItem(DEFAULT_DEVICE_KEY); } catch { return null; } })());
  const [devMenu, setDevMenu] = useState(false);
  const [save, setSave] = useState<SaveState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readOnly = !record;
  const err = validateViewfinderLayout(layout);

  // Changes save 600 ms after the last edit, once the layout is valid (a missing shutter waits).
  const persist = (l: ViewfinderLayout, n: string, device: string | null = deviceId) => {
    if (!record) return;
    if (timer.current) clearTimeout(timer.current);
    if (validateViewfinderLayout(l) || !n.trim()) { setSave("dirty"); return; }
    setSave("dirty");
    timer.current = setTimeout(() => {
      setSave("saving");
      putLayout({ id: record.id, name: n.trim(), layout: l, device_id: device }).then((r) => { setSave("saved"); onSaved?.(r); }).catch(() => setSave("error"));
    }, 600);
  };
  const change = (l: ViewfinderLayout) => { setLayout(l); persist(l, name); };
  const setDevice = (id: string | null) => {
    setDeviceIdState(id);
    if (record) persist(layout, name, id);
    else try { if (id) localStorage.setItem(DEFAULT_DEVICE_KEY, id); else localStorage.removeItem(DEFAULT_DEVICE_KEY); } catch { /* per-browser convenience */ }
  };
  const device = devices.devices.find((d) => d.id === deviceId) ?? null;
  const o = layout[orient];
  // While the phone previews, it follows every edit and the orientation picked here (also after switching layouts).
  useEffect(() => {
    if (!phone.previewing || err) return;
    const t = setTimeout(() => phone.show(layout, orient), 120);
    return () => clearTimeout(t);
  }, [phone.previewing, layout, orient, !!err]);
  const setO = (next: VfOrientation) => change({ ...layout, [orient]: next });

  async function remove() {
    if (!record) return;
    const ok = await confirmDialog({ title: `Delete “${record.name}”?`, body: "A phone using it goes back to the default layout on its next sync.", confirmLabel: "Delete layout", danger: true });
    if (!ok) return;
    try { await deleteLayout(record.id); onDeleted?.(); toast("Layout deleted"); } catch (e) { toast(`Delete failed: ${(e as Error).message}`, "danger"); }
  }
  async function reset() {
    const ok = await confirmDialog({ title: "Reset to the default layout?", body: "Both orientations go back to the arrangement the app ships with. The name stays.", confirmLabel: "Reset" });
    if (ok) change(clone(DEFAULT_VIEWFINDER_LAYOUT));
  }

  const screen = deviceScreen(device?.specs ?? null, orient === "portrait");
  const canPreview = phone.connected && phone.phones.length > 0 && !err;
  return (
    <>
      <div class="f-scroll" style={{ flex: 1 }}>
        <div class="vf-editor">
          <div class="plan-head">
            {readOnly ? <strong class="vf-editor__title">Default <span class="meta">built in</span></strong>
              : <Input value={name} maxLength={80} aria-label="Layout name" style={{ fontWeight: 700 }} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setName(v); persist(layout, v); }} />}
            <Seg label="Orientation" value={orient} onChange={setOrient} options={[{ id: "portrait", label: "Portrait" }, { id: "landscape", label: "Landscape" }]} />
            {devices.devices.length === 0
              ? <Button kind="secondary" size="sm" icon="cellphone-cog" onClick={() => devices.add((d) => setDevice(d.id))}>Add device specs</Button>
              : (
                <span class="vf-editor__device">
                  <Select label="Device" icon="cellphone" width="220px" value={device?.id ?? ""} onChange={(v) => (v === ADD_DEVICE ? devices.add((d) => setDevice(d.id)) : setDevice(v || null))}
                    options={[...(device ? [] : [{ value: "", label: "Choose a device…" }]), ...devices.devices.map((d) => ({ value: d.id, label: d.name })), { value: ADD_DEVICE, label: "Add device specs…" }]} />
                  {device && (
                    <span class="menu-anchor">
                      <IconButton icon="dots-vertical" label="Device…" title="Device…" onClick={() => setDevMenu((x) => !x)} />
                      {devMenu && (
                        <Popover onClose={() => setDevMenu(false)}>
                          <MenuItem icon="cellphone-arrow-down" onClick={() => { setDevMenu(false); devices.add(); }}>Read out again…</MenuItem>
                          <MenuItem icon="pencil-outline" onClick={() => { setDevMenu(false); void devices.rename(device); }}>Rename…</MenuItem>
                          <MenuItem icon="delete-outline" danger onClick={() => { setDevMenu(false); void devices.remove(device); }}>Delete device…</MenuItem>
                        </Popover>
                      )}
                    </span>
                  )}
                </span>
              )}
            <div class="plan-head__status">
              {phone.previewing
                ? <Button kind="secondary" size="sm" icon="cellphone-off" onClick={phone.stop}>Stop phone preview</Button>
                : <Button kind="secondary" size="sm" icon="cellphone-play" disabled={!canPreview}
                    title={!phone.connected ? "Not connected to the server" : !phone.phones.length ? "No phone connected: open the app on the phone" : err ? "Fix the layout first" : "Show this layout on the phone, live"}
                    onClick={() => phone.show(layout, orient)}>Preview on phone</Button>}
              {!readOnly && <SaveStatus state={save} onRetry={() => persist(layout, name)} />}
              {readOnly ? <Button size="sm" icon="content-copy" onClick={onDuplicate}>Duplicate to edit</Button> : (
                <>
                  <Button kind="secondary" size="sm" icon="content-copy" onClick={onDuplicate}>Duplicate</Button>
                  <Button kind="secondary" size="sm" icon="restore" onClick={() => void reset()}>Reset to default</Button>
                  <IconButton icon="delete-outline" label="Delete layout…" title="Delete layout…" onClick={() => void remove()} />
                </>
              )}
            </div>
          </div>
          {err && !readOnly && <Banner kind="warn" title="Not saved yet" meta={err} />}
          {!device && <Banner kind="info" icon="cellphone-cog" title="Generic phone size" meta="Add device specs from your phone to preview on its real screen and lenses." />}
          {device && screen.guessed && <Banner kind="info" icon="rotate-3d-variant" title={`${orient === "portrait" ? "Portrait" : "Landscape"} not read out yet`} meta={`Turned from the other orientation. Show Shoot ${orient === "portrait" ? "upright" : "sideways"} on the phone and read it out again.`} />}
          <Preview orientation={o} portrait={orient === "portrait"} screen={screen} stops={device?.specs.stops ?? null} />
        </div>
      </div>
      <Panel width="380px">
        <PanelHead title={`Bars · ${orient}`}>{!readOnly && o.bars.length < 4 && <Button kind="secondary" size="sm" icon="plus" onClick={() => setO({ bars: [...o.bars, { id: crypto.randomUUID().slice(0, 8), edge: "end", items: [] }] })}>Bar</Button>}</PanelHead>
        <PanelBody>
          {readOnly && <EmptyNote>The built-in default can't be changed. Duplicate it to make your own.</EmptyNote>}
          {o.bars.map((b, i) => <BarEditor key={b.id} bar={b} index={i} count={o.bars.length} portrait={orient === "portrait"} orientation={o} readOnly={readOnly}
            onChange={(nb) => setO({ bars: o.bars.map((x) => (x.id === b.id ? nb : x)) })}
            onMove={(d) => { const bars = [...o.bars]; const [x] = bars.splice(i, 1); bars.splice(i + d, 0, x); setO({ bars }); }}
            onRemove={() => setO({ bars: o.bars.filter((x) => x.id !== b.id) })} />)}
          {!readOnly && unplaced(o).length > 0 && <span class="meta">Not shown in {orient}: {unplaced(o).map((c) => VF_CONTROL_LABELS[c]).join(", ")}.</span>}
        </PanelBody>
      </Panel>
    </>
  );
}

function BarEditor({ bar, index, count, portrait, orientation, readOnly, onChange, onMove, onRemove }: {
  bar: VfBar; index: number; count: number; portrait: boolean; orientation: VfOrientation; readOnly: boolean;
  onChange: (b: VfBar) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const setItem = (i: number, patch: Partial<VfItem>) => onChange({ ...bar, items: bar.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const moveItem = (i: number, d: -1 | 1) => { const items = [...bar.items]; const [x] = items.splice(i, 1); items.splice(i + d, 0, x); onChange({ ...bar, items }); };
  const free = unplaced(orientation);
  const edges = portrait ? [{ id: "start", label: "Top" }, { id: "end", label: "Bottom" }] : [{ id: "start", label: "Left" }, { id: "end", label: "Right" }];
  return (
    <div class={cx("vf-bar-ed", readOnly && "is-readonly")}>
      <div class="vf-bar-ed__head">
        <strong>Bar {index + 1}</strong>
        <Seg label={`Edge of bar ${index + 1}`} value={bar.edge} onChange={(edge) => !readOnly && onChange({ ...bar, edge: edge as VfBar["edge"] })} options={edges} />
        <span class="grow" />
        {!readOnly && <ReorderButtons index={index} count={count} onMove={(_, d) => onMove(d)} onRemove={onRemove} up={{ label: "Earlier (closer to the top or left)" }} down={{ label: "Later" }} remove={{ label: "Remove the bar" }} />}
      </div>
      {bar.items.length === 0 && <span class="meta">Empty: add a control below.</span>}
      {bar.items.map((it, i) => (
        <div key={it.control} class="vf-item-ed">
          <span class="vf-item-ed__name">{VF_CONTROL_LABELS[it.control]}</span>
          {it.control === "lens" ? (
            <>
              <Seg label="Lens display" value={it.display ?? "list"} onChange={(v) => !readOnly && setItem(i, { display: v as VfItem["display"] })} options={[{ id: "list", label: "List" }, { id: "carousel", label: "Carousel" }]} />
              <Seg label="Lens size" value={it.size ?? "fill"} onChange={(v) => !readOnly && setItem(i, { size: v as VfItem["size"] })} options={[{ id: "fill", label: "Fill · scroll" }, { id: "fit", label: "Fit" }]} />
            </>
          ) : it.control === "zoom" ? <span class="meta">The phone's lenses, when it has more than one</span>
            : it.control !== "shutter" && <Checkbox checked={!!it.label} role="checkbox" aria-checked={!!it.label} onClick={() => !readOnly && setItem(i, { label: !it.label })}>Label</Checkbox>}
          <span class="grow" />
          {!readOnly && <ReorderButtons index={i} count={bar.items.length} onMove={(at, d) => moveItem(at, d)} onRemove={() => onChange({ ...bar, items: bar.items.filter((_, j) => j !== i) })} remove={{ label: `Remove ${VF_CONTROL_LABELS[it.control]}` }} />}
        </div>
      ))}
      {!readOnly && free.length > 0 && bar.items.length < 9 && (
        <Select label="Add a control" icon="plus" width="220px" value="" onChange={(v) => v && onChange({ ...bar, items: [...bar.items, v === "lens" ? { control: "lens", display: "list", size: "fill" } : { control: v as VfControl }] })}
          options={[{ value: "", label: "Add a control…" }, ...free.map((c) => ({ value: c, label: VF_CONTROL_LABELS[c] }))]} />
      )}
    </div>
  );
}

/** The screen as the phone lays it out: start bars, the 4:3 camera preview, end bars; scaled to fit. */
function Preview({ orientation: o, portrait, screen, stops }: { orientation: VfOrientation; portrait: boolean; screen: { w: number; h: number }; stops: number[] | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState({ w: 600, h: 600 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setAvail({ w: r.width, h: r.height }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(1, avail.w / screen.w, avail.h / screen.h);
  const start = o.bars.filter((b) => b.edge === "start"), end = o.bars.filter((b) => b.edge === "end");
  const ext = (bars: VfBar[]) => !bars.length ? 0 : portrait
    ? SZ.padStart + bars.reduce((a, b) => a + (b.items.some((i) => i.control === "shutter") ? SZ.shutter : SZ.row), 0) + SZ.gap * (bars.length - 1) + SZ.padEnd + SZ.line
    : bars.length * SZ.column;
  const area = portrait ? { w: screen.w, h: screen.h - ext(start) - ext(end) } : { w: screen.w - ext(start) - ext(end), h: screen.h };
  const aspect = portrait ? 3 / 4 : 4 / 3;
  const cam = area.w / aspect <= area.h ? { w: area.w, h: area.w / aspect } : { w: area.h * aspect, h: area.h };
  const edgeBlock = (bars: VfBar[], isStart: boolean) => !bars.length ? null : portrait
    ? <div class={cx("vf-chrome", isStart && "vf-chrome--top")}>{bars.map((b) => <PreviewBar key={b.id} bar={b} vertical={false} stops={stops} />)}</div>
    : bars.map((b) => <div key={b.id} class={cx("vf-side", isStart ? "vf-side--start" : "vf-side--end")}><PreviewBar bar={b} vertical stops={stops} /></div>);
  return (
    <div ref={box} class="vf-stage">
      <div class="vf-screen" style={{ width: `${screen.w}px`, height: `${screen.h}px`, transform: `scale(${scale})`, flexDirection: portrait ? "column" : "row" }}>
        {edgeBlock(start, true)}
        <div class="vf-area" style={{ width: `${Math.max(0, area.w)}px`, height: `${Math.max(0, area.h)}px` }}>
          <div class="vf-cam" style={{ width: `${cam.w}px`, height: `${cam.h}px` }}><div class="vf-cam__frame" /></div>
          {area.w < 120 || area.h < 120 ? <span class="vf-area__warn">Hardly any room for the image</span> : null}
        </div>
        {edgeBlock(end, false)}
      </div>
      <span class="meta num vf-stage__size">{screen.w} × {screen.h} px · camera image {Math.round(cam.w)} × {Math.round(cam.h)}</span>
    </div>
  );
}

/** `stops`: the device's phone lenses (issue #68), or a typical set without a device. */
function PreviewBar({ bar, vertical, stops }: { bar: VfBar; vertical: boolean; stops: number[] | null }) {
  const zooms = stops ?? [0.5, 1, 3];
  const fixed = bar.items.some((i) => i.control === "lens" && i.size !== "fit");
  const height = bar.items.some((i) => i.control === "shutter") ? SZ.shutter : SZ.row;
  return (
    <div class={cx("vf-bar", vertical && "vf-bar--v")} style={vertical ? undefined : { height: `${height}px` }}>
      {bar.items.map((it) => {
        if (it.control === "shutter") return <span key="shutter" class="vf-shutter" title="Shutter" />;
        if (it.control === "zoom") {
          return (
            <span key="zoom" class={cx("vf-lens", vertical && "vf-lens--v", "is-fit")} title="Phone lenses">
              {zooms.length > 1 && zooms.map((z) => <span key={z} class={cx("vf-pill", z === 1 && "is-on")}>{z}<small>×</small></span>)}
            </span>
          );
        }
        if (it.control === "lens") {
          return (
            <span key="lens" class={cx("vf-lens", vertical && "vf-lens--v", it.size === "fit" ? "is-fit" : "is-fill")}>
              {it.display === "carousel"
                ? <><Icon name={vertical ? "chevron-up" : "chevron-left"} /><span class="vf-pill is-on">35<small>mm</small></span><Icon name={vertical ? "chevron-down" : "chevron-right"} /></>
                : [18, 24, 35, 50, 85].map((mm) => <span key={mm} class={cx("vf-pill", mm === 35 && "is-on")}>{mm}{mm === 35 && <small>mm</small>}</span>)}
            </span>
          );
        }
        return (
          <span key={it.control} class={cx("vf-cell", fixed && "is-fixed")}>
            <span class={cx("vf-btn", vertical && "vf-btn--v")} title={VF_CONTROL_LABELS[it.control]}>
              <Icon name={ICONS[it.control]} />
              {it.label && <small>{VF_SHORT_LABELS[it.control]}</small>}
            </span>
          </span>
        );
      })}
    </div>
  );
}
