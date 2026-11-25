// The Hardware extension in the Studio's Devices app (docs/features/hardware.md, U6): a card per device with its
// first controls ready to use, a panel with everything its catalogue model exposes, table cells, the proxy pill and
// Add a device. Commands go to the phone that holds the connections, through the link's `hardware` channel.
import "./hardware.css";
import { useEffect, useState } from "preact/hooks";
import {
  AppIcon, Banner, BatteryBar, Button, ConnectionMark, DeviceCard, Dialog, DropdownMenu, EmptyState, List, ListRow, PropertyList, PropertyRow, Select, Spinner, TextInput, cx, type IconName, type Tone,
} from "@openclapper/design";
import {
  CATALOGUE, PROVISION_STAGE_LABELS, TYPE_LABELS, controlGroups, formatValue, modelName, modelOf, stateValue, CCU_PARAMS,
  type FixtureLive, type HardwareBody, type HardwareType, type Model, type ScannedDevice,
} from "@openclapper/ext-hardware";
import { ApiError, send, type FileRec } from "../../api";
import * as store from "../../files";
import { confirm, toast, toastError } from "../../hosts";
import type { DeviceCells } from "../../devices";
import { ControlView, useHeld } from "./Controls";
import { command, isBusy, request, useHardware, type HardwareCtx } from "./link";

export const TYPE_LOOK: Record<HardwareType, { icon: IconName; color: number }> = { light: { icon: "light-fixture", color: 3 }, battery: { icon: "battery", color: 4 }, camera: { icon: "video", color: 1 }, transmitter: { icon: "antenna", color: 8 } };
const bodyOf = (d: FileRec) => d.body as unknown as HardwareBody;
const liveOf = (ctx: HardwareCtx, id: string): FixtureLive | undefined => ctx.state?.devices.find((x) => x.id === id);

/** How a device's connection reads, in colour. */
function linkOf(d: FileRec, ctx: HardwareCtx): { tone: Tone; label: string } {
  const b = bodyOf(d), m = modelOf(b.model), l = liveOf(ctx, d.id);
  if (b.asleep) return { tone: "off", label: "Asleep · not connecting" };
  if (m?.transport === "wifi") return { tone: "off", label: "On the device only" };
  if (!ctx.state) return { tone: "off", label: ctx.link.open ? "No proxy" : "Device link offline" };
  switch (l?.link) {
    case "ready": return { tone: "ok", label: "Connected" };
    case "silent": return { tone: "warn", label: "In the mesh, not answering (off?)" };
    case "waiting": return { tone: "warn", label: "Waiting to connect" };
    case "absent": return { tone: "off", label: "Not in range" };
    case "connecting": return { tone: "warn", label: "Connecting…" };
    case "retrying": return { tone: "warn", label: `Reconnecting (try ${l.attempt + 1})${l.error ? ` · ${l.error}` : ""}` };
    case "failed": return { tone: "danger", label: l.error ?? "Cannot connect" };
    default: return { tone: "off", label: "Not connected" };
  }
}
/** Its own charge, or that of the battery it runs on. */
function chargeOf(d: FileRec, all: FileRec[], ctx: HardwareCtx): { charge?: number; minutes?: number; from?: string; known: boolean } {
  const own = liveOf(ctx, d.id)?.telemetry;
  if (own?.battery !== undefined) return { charge: own.battery, minutes: own.minutesLeft, known: true };
  const m = modelOf(bodyOf(d).model);
  const bat = bodyOf(d).poweredBy ? all.find((x) => x.id === bodyOf(d).poweredBy) : undefined;
  if (bat) { const t = liveOf(ctx, bat.id)?.telemetry; return { charge: t?.battery, minutes: t?.minutesLeft, from: bat.name, known: true }; }
  return { known: !!m?.states.some((s) => s.id === "battery") };
}
const powerText = (d: FileRec, all: FileRec[]) => {
  const b = bodyOf(d), m = modelOf(b.model)!;
  if (m.powers) { const p = all.filter((x) => (x.body as { poweredBy?: unknown }).poweredBy === d.id); return p.length ? `Powers ${p.map((x) => x.name).join(", ")}` : "Powers nothing"; }
  if (m.takesBattery) return b.poweredBy ? `On ${all.find((x) => x.id === b.poweredBy)?.name ?? "a battery that is gone (socket)"}` : "On a socket";
  return m.states.some((s) => s.id === "battery") ? "Own battery" : "Own power";
};

export function useContext(_files: FileRec[]) { return useHardware(); }

export function cells(d: FileRec, all: FileRec[], ctx: HardwareCtx): DeviceCells {
  const m = modelOf(bodyOf(d).model)!;
  const l = linkOf(d, ctx), ch = chargeOf(d, all, ctx);
  return {
    type: <span className="dev-type"><AppIcon glyph={TYPE_LOOK[m.type].icon} color={TYPE_LOOK[m.type].color} size={16} />{TYPE_LABELS[m.type].label}</span>,
    model: modelName(m), link: <ConnectionMark tone={l.tone} label={l.label} />, battery: ch.known ? <BatteryBar charge={ch.charge} minutes={ch.minutes} /> : "", power: powerText(d, all),
  };
}

/** A device across the width: who it is, its connection and battery, its first controls; Open shows everything. */
export function Card({ d, all, ctx }: { d: FileRec; all: FileRec[]; ctx: HardwareCtx }) {
  const b = bodyOf(d), m = modelOf(b.model)!;
  const [open, setOpen] = useState(false);
  const l = liveOf(ctx, d.id), link = linkOf(d, ctx), ch = chargeOf(d, all, ctx);
  const held = useHeld();
  const first = controlGroups(m, "everywhere")[0];
  const quick = first?.controls.filter((c) => c.kind !== "outputs" && c.kind !== "effect").slice(0, m.type === "camera" ? 2 : 5) ?? [];
  const ready = l?.link === "ready" && !isBusy(d.id);
  return (
    <>
      <DeviceCard icon={TYPE_LOOK[m.type].icon} color={TYPE_LOOK[m.type].color} name={d.name} sub={modelName(m)} off={b.asleep || (!ready && m.transport !== "wifi")} onOpen={() => setOpen(true)}
        connection={<ConnectionMark tone={link.tone} label={link.label} />} battery={ch.known ? <BatteryBar charge={ch.charge} minutes={ch.minutes} label={ch.from ? `Battery ${ch.from}` : "Charge"} /> : undefined}
        actions={<DeviceMenu d={d} ctx={ctx} onOpen={() => setOpen(true)} />}>
        {quick.map((c) => <ControlView key={c.id} m={m} c={c} live={l} held={held} disabled={!ready} send={(cmd) => command(d.id, cmd)} />)}
        {isBusy(d.id) && <span className="hw-note">A flow drives it now</span>}
        {m.type === "camera" && l?.telemetry?.camera?.timecode && <span className="hw-tc">{l.telemetry.camera.timecode}</span>}
        {m.feeds.length > 0 && <span className="hw-note">{m.feeds.map((f) => `${f.label}: on the device only`).join(" · ")}</span>}
        {m.type === "battery" && <span className="hw-note">{powerText(d, all)}</span>}
        {(m.takesBattery || m.powers) && m.type !== "battery" && <span className="hw-note">{powerText(d, all)}</span>}
      </DeviceCard>
      {open && <Panel d={d} all={all} ctx={ctx} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeviceMenu({ d, ctx, onOpen }: { d: FileRec; ctx: HardwareCtx; onOpen: () => void }) {
  const b = bodyOf(d);
  return (
    <DropdownMenu size="sm" variant="quiet" icon="more" align="end"
      items={[{ id: "open", label: "Open", icon: "external" }, { id: "sleep", label: b.asleep ? "Wake" : "Sleep", icon: b.asleep ? "sun" : "moon" }, { separator: true }, { id: "remove", label: "Remove…", icon: "trash", danger: true }]}
      onSelect={(x) => { if (x === "open") onOpen(); else if (x === "sleep") void sleep(d, ctx); else void remove(d); }} />
  );
}

async function sleep(d: FileRec, _ctx: HardwareCtx) {
  const b = bodyOf(d);
  try { await store.saveBody(d, { ...b, asleep: !b.asleep } as unknown as Record<string, unknown>); request({ type: "sync" }); toast(b.asleep ? `${d.name} woken` : `${d.name} asleep`, { tone: "info" }); } catch (e) { toastError(e); }
}
async function remove(d: FileRec) {
  const m = modelOf(bodyOf(d).model)!;
  if (!(await confirm({ danger: true, title: `Remove “${d.name}”?`, message: m.transport === "mesh" && bodyOf(d).mesh ? "It goes to the recycle bin. The light keeps the device's network keys until it is reset on the light itself." : "It goes to the recycle bin.", confirmLabel: "Remove" }))) return;
  try { await store.bin("home", [d.id]); request({ type: "sync" }); } catch (e) { toastError(e); }
}

/** Everything a device exposes, its readings, pairing, power, sleep, name. */
function Panel({ d, all, ctx, onClose }: { d: FileRec; all: FileRec[]; ctx: HardwareCtx; onClose: () => void }) {
  const b = bodyOf(d), m = modelOf(b.model)!;
  const l = liveOf(ctx, d.id), link = linkOf(d, ctx);
  const ready = l?.link === "ready" && !isBusy(d.id);
  const held = useHeld();
  const [name, setName] = useState(d.name);
  const groups = controlGroups(m, "everywhere");
  const [shut, setShut] = useState(() => new Set(groups.filter((g) => g.folded).map((g) => g.group)));
  const prov = ctx.provision?.device === d.id ? ctx.provision : null;
  const batteries = all.filter((x) => modelOf(bodyOf(x).model)?.powers);
  const rename = () => { const to = name.trim(); if (!to || to === d.name) { setName(d.name); return; } void store.rename(d, to).then(() => request({ type: "sync" }), toastError); };
  const power = async (battery: string | null) => {
    try { await send("PUT", `/api/hardware/devices/${d.id}/power`, { battery }); await store.loadRoot("home"); request({ type: "sync" }); } catch (e) { toastError(e); }
  };
  const cam = l?.telemetry?.camera;
  const params = Object.entries(cam?.params ?? {}).sort(([a], [x]) => a.localeCompare(x, undefined, { numeric: true }));
  return (
    <Dialog fixed className="hw-panel" title={<span className="hw-panel__title"><AppIcon glyph={TYPE_LOOK[m.type].icon} color={TYPE_LOOK[m.type].color} size={20} />{d.name}<small>{modelName(m)}</small></span>} onClose={onClose}>
      <div className="hw-panel__state"><ConnectionMark tone={link.tone} label={link.label} />{cam?.timecode && <span className="hw-tc">{cam.timecode}</span>}{cam?.protocolVersion && <small>protocol {cam.protocolVersion}</small>}</div>
      {m.type === "camera" && !ready && <p className="st-note">First connection: the camera shows a 6-digit PIN in its Bluetooth menu; type it into the pairing dialog on the proxy device. Bluetooth must be on in the camera's Setup menu.</p>}
      {m.feeds.length > 0 && <Banner tone="info" title={`${m.feeds.map((f) => f.label).join(", ")}: on the device only`}>It comes over the transmitter's own Wi-Fi, which only the device joins. Open the device in Hardware on the device.</Banner>}

      {m.transport === "mesh" && (
        <section className="hw-group">
          <h4>Pairing</h4>
          {prov && <Banner tone={prov.phase === "error" ? "danger" : prov.phase === "done" ? "success" : "info"} title={prov.phase === "error" ? prov.error ?? "Pairing failed" : prov.phase === "done" ? "Paired" : prov.stage ? PROVISION_STAGE_LABELS[prov.stage] : "Starting…"} />}
          {!b.mesh && <p className="st-note">Not paired with the device's network yet. Remove the light from Sidus Link first, or reset it.</p>}
          <div className="hw-row">
            <Button size="sm" variant={b.mesh ? "secondary" : "primary"} icon="bluetooth" disabled={!ctx.state || prov?.phase === "running"} onClick={() => request({ type: "provision", device: d.id })}>{b.mesh ? "Run setup again" : "Pair with OpenClapper"}</Button>
            {b.mesh && <Button size="sm" variant="secondary" icon="refresh" disabled={!ctx.state || prov?.phase === "running"} onClick={() => request({ type: "provision", device: d.id, fresh: true })}>Pair again (after a reset)</Button>}
          </div>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.group} className={cx("hw-group", shut.has(g.group) && "is-shut")}>
          <h4><button type="button" onClick={() => setShut((s) => { const n = new Set(s); if (n.has(g.group)) n.delete(g.group); else n.add(g.group); return n; })} aria-expanded={!shut.has(g.group)}>{g.group}</button></h4>
          {!shut.has(g.group) && <div className="hw-ctls">{g.controls.map((c) => <ControlView key={c.id} m={m} c={c} live={l} held={held} disabled={!ready} send={(cmd) => command(d.id, cmd)} />)}</div>}
        </section>
      ))}

      {m.states.length > 0 && (
        <section className="hw-group"><h4>Reported</h4>
          <PropertyList>{m.states.map((s) => <PropertyRow key={s.id} label={s.label}>{formatValue(s.format, stateValue(s, l))}</PropertyRow>)}</PropertyList>
        </section>
      )}
      {m.type === "camera" && (
        <>
          <section className="hw-group is-shut-able"><h4>{`Reported by the camera (${params.length})`}</h4>
            {params.length ? <dl className="hw-facts">{params.map(([k, v]) => <><dt key={`${k}-k`} title={k}>{CCU_PARAMS[k]?.name ?? `Undocumented ${k}`}</dt><dd key={`${k}-v`}>{typeof v === "string" ? v : v.map((x) => (Number.isInteger(x) ? String(x) : x.toFixed(2))).join(", ")}</dd></>)}</dl> : <p className="st-note">Nothing yet: the camera reports its settings after pairing.</p>}
          </section>
          <section className="hw-group"><h4>Incoming log</h4><pre className="hw-log">{(cam?.log ?? []).join("\n") || "—"}</pre></section>
        </>
      )}

      <section className="hw-group">
        <h4>Power</h4>
        {m.takesBattery ? (
          <Select size="sm" aria-label="Runs on" value={b.poweredBy ?? ""} onChange={(v: string) => void power(v || null)}
            options={[{ value: "", label: "A socket" }, ...batteries.map((x) => { const other = all.find((y) => y.id !== d.id && (y.body as { poweredBy?: unknown }).poweredBy === x.id); return { value: x.id, label: other ? `${x.name} (now on ${other.name})` : x.name }; })]} />
        ) : <p className="st-note">{powerText(d, all)}</p>}
      </section>

      <section className="hw-group">
        <h4>Device</h4>
        <div className="hw-row">
          <TextInput size="sm" value={name} aria-label="Name" maxLength={120} onInput={(e) => setName(e.currentTarget.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          <Button size="sm" variant="secondary" icon={b.asleep ? "sun" : "moon"} onClick={() => void sleep(d, ctx)}>{b.asleep ? "Wake" : "Sleep"}</Button>
          <Button size="sm" variant="danger" icon="trash" onClick={() => void remove(d).then(onClose)}>Remove…</Button>
        </div>
        <p className="st-note">An asleep device gets no connection attempts until it is woken. {m.pairing}</p>
      </section>
    </Dialog>
  );
}

/** The toolbar's parts: which phone holds the connections, Reconnect all, Add a device. */
export function Toolbar({ files, ctx }: { files: FileRec[]; ctx: HardwareCtx }) {
  const [adding, setAdding] = useState(false);
  const s = ctx.state;
  return (
    <>
      <span className={cx("lay-pill", s ? "is-preview" : "is-none")} title="The device that holds the Bluetooth connections (Hardware on the device, its proxy switch)"><i />{s ? `Proxy: ${s.phone.name || "a device"}` : "No proxy"}</span>
      <Button size="sm" variant="quiet" icon="refresh" disabled={!s} title="Drops every connection and connects again, one by one; the lights keep their state" onClick={() => { request({ type: "reconnect" }); toast("Reconnecting, one device at a time", { tone: "info" }); }}>Reconnect all</Button>
      <Button size="sm" variant="secondary" icon="plus" onClick={() => setAdding(true)}>Add a device</Button>
      {adding && <AddDevice files={files} ctx={ctx} onClose={() => setAdding(false)} />}
    </>
  );
}

/** Add a device (U6): the proxy phone scans; the list shows what it found beside the catalogue; pick, confirm the model, name it. */
function AddDevice({ ctx, onClose }: { files: FileRec[]; ctx: HardwareCtx; onClose: () => void }) {
  const [picked, setPicked] = useState<ScannedDevice | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const proxy = !!ctx.state;
  useEffect(() => { if (proxy) request({ type: "scan", on: true }); return () => request({ type: "scan", on: false }); }, [proxy]);
  const scan = ctx.scan;
  const save = async () => {
    if (!model) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      await send("POST", "/api/hardware/devices", { id, model: model.id, address: model.transport === "wifi" ? null : picked?.address, ...(name.trim() ? { name: name.trim() } : {}) });
      await store.loadRoot("home");
      request({ type: "sync" });
      if (model.transport === "mesh") setTimeout(() => request({ type: "provision", device: id }), 500);
      toast(model.transport === "mesh" ? "Added; the device pairs it now" : "Added", { tone: "info" });
      onClose();
    } catch (e) { toastError(e instanceof ApiError ? e : e); } finally { setBusy(false); }
  };
  return (
    <Dialog fixed className="hw-add" title={model ? modelName(model) : picked ? (picked.name ?? picked.address) : "Add a device"} onClose={onClose}
      footer={model ? <><Button variant="quiet" onClick={() => setModel(null)}>Back</Button><Button variant="primary" icon="plus" disabled={busy} onClick={() => void save()}>{model.transport === "mesh" ? "Add and pair" : "Add"}</Button></> : picked ? <Button variant="quiet" onClick={() => setPicked(null)}>Back</Button> : undefined}>
      {model ? (
        <>
          <label className="hw-ctl"><small>Name</small><TextInput value={name} placeholder={modelName(model)} maxLength={120} onInput={(e) => setName(e.currentTarget.value)} /></label>
          <p className="st-note">{model.pairing}</p>
        </>
      ) : picked ? (
        <List className="hw-add__models">
          {[...picked.kinds.map((k) => modelOf(k)).filter((x): x is Model => !!x), ...CATALOGUE.filter((x) => x.transport !== "wifi" && !picked.kinds.includes(x.id))].map((x, i) => (
            <ListRow key={x.id} leading={<AppIcon glyph={TYPE_LOOK[x.type].icon} color={TYPE_LOOK[x.type].color} size={20} />} meta={i < picked.kinds.length ? "Likely" : TYPE_LABELS[x.type].label} onClick={() => setModel(x)}>{modelName(x)}</ListRow>
          ))}
        </List>
      ) : (
        <div className="hw-add__cols">
          <section>
            <h4>{proxy ? (scan?.phase === "scanning" ? "Found nearby · scanning…" : "Found nearby") : "Found nearby"}</h4>
            {!proxy && <Banner tone="info" title="No proxy">The device scans: open Hardware on the device and switch its proxy on.</Banner>}
            {scan?.phase === "error" && <Banner tone="danger" title={scan.message ?? "Scan failed"} />}
            {proxy && !scan?.found.length && (scan?.phase === "scanning" ? <Spinner /> : <EmptyState icon="bluetooth" title="Nothing found">Switch the device on and keep it close to the device.</EmptyState>)}
            <List>{scan?.found.map((f) => (
              <ListRow key={f.address} leading={<AppIcon glyph={f.kinds.length ? TYPE_LOOK[modelOf(f.kinds[0])!.type].icon : "bluetooth"} color={f.kinds.length ? TYPE_LOOK[modelOf(f.kinds[0])!.type].color : 0} size={20} />}
                meta={[f.kinds.length ? `Likely ${modelName(modelOf(f.kinds[0])!)}` : null, f.address, f.rssi !== null ? `${f.rssi} dBm` : null].filter(Boolean).join(" · ")} onClick={() => setPicked(f)}>{f.name ?? f.address}</ListRow>
            ))}</List>
            {proxy && <Button size="sm" variant="quiet" icon="refresh" disabled={scan?.phase === "scanning"} onClick={() => request({ type: "scan", on: true })}>Scan again</Button>}
          </section>
          <section>
            <h4>Supported hardware</h4>
            <List>{CATALOGUE.map((x) => (
              <ListRow key={x.id} leading={<AppIcon glyph={TYPE_LOOK[x.type].icon} color={TYPE_LOOK[x.type].color} size={20} />}
                meta={x.transport === "wifi" ? "Add without a scan · picture on the device only" : `${TYPE_LABELS[x.type].label} · ${x.transport === "mesh" ? "Bluetooth Mesh" : "Bluetooth"}`}
                onClick={x.transport === "wifi" ? () => setModel(x) : undefined}>{modelName(x)}</ListRow>
            ))}</List>
          </section>
        </div>
      )}
    </Dialog>
  );
}
