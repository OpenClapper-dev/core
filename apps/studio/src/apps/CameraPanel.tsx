import { useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { BMD_STATUS_FLAGS, CCU_PARAMS, TARGET_DISPLAYS, TOOL_BITS, type CcuMessage, type CcuType, type FixtureLive } from "@openclapper/vocab";
import { Banner, Button, Checkbox, Field, IconButton, Input, Panel, PanelBody, PanelHead, Seg, Select } from "@openclapper/ui";
import type { ServerFixture } from "../api";
import { Range } from "../compose/editor";
import type { LightProxy } from "../lightProxy";

/**
 * A Blackmagic camera in Devices (#318): every control of Blackmagic's camera control protocol that
 * the Pocket takes, grouped like the camera's menus, set from what the camera reports where it
 * reports it. Per output (LCD, HDMI): zebra, focus assist and false colour carry a target (the
 * camera honours protocol v1.6.2's target field, owner's test 2026-11-08). No Display LUT control:
 * the Pocket reports 1.15 but ignored every write tried (docs/features/cameras.md).
 */

const ISO = [100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600];
const ANGLES = [11.25, 22.5, 45, 60, 90, 120, 144, 150, 172.8, 180, 216, 270, 324, 360];
const AE_MODES = ["Manual trigger", "Iris", "Shutter", "Iris + shutter", "Shutter + iris"];
const DYNAMIC_RANGE = ["Film", "Video", "Extended video"];
const SHARPENING = ["Off", "Low", "Medium", "High"];
/** 10.0: basic codec and variant, as the protocol numbers them. */
const CODECS: { label: string; v: [number, number] }[] = [
  ...[["Q0", 0], ["Q1", 7], ["Q3", 8], ["Q5", 1], ["3:1", 2], ["5:1", 3], ["8:1", 4], ["12:1", 5]].map(([n, v]) => ({ label: `Blackmagic RAW ${n}`, v: [3, v as number] as [number, number] })),
  ...[["HQ", 0], ["422", 1], ["LT", 2], ["Proxy", 3]].map(([n, v]) => ({ label: `ProRes ${n}`, v: [2, v as number] as [number, number] })),
];
const GUIDES = ["Off", "2.4:1", "2.39:1", "2.35:1", "1.85:1", "16:9", "14:9", "4:3", "2:1", "4:5", "1:1"];
const FOCUS_METHOD = ["Peak", "Coloured lines"];
const FOCUS_COLOUR = ["Red", "Green", "Blue", "White", "Black"];
const AUDIO_INPUT = ["Internal mic", "Line", "Low mic", "High mic"];
const SHOT_TAGS = ["None", "WS", "CU", "MS", "BCU", "MCU", "ECU"];
type Output = "lcd" | "hdmi";
const OUTPUTS: { id: Output; label: string }[] = [{ id: "lcd", label: "LCD" }, { id: "hdmi", label: "HDMI" }];

export function CameraPanel({ f, live, proxy, onClose, children }: { f: ServerFixture; live: FixtureLive | undefined; proxy: LightProxy; onClose: () => void; children?: ComponentChildren }) {
  const cam = live?.telemetry?.camera;
  const ready = live?.link === "ready";
  const send = (category: number, parameter: number, type: CcuType, data: number[] | string, operation: 0 | 1 = 0) =>
    proxy.send(f.id, { op: "ccu", message: { category, parameter, type, operation, data } as CcuMessage });
  /** What the camera last reported for a parameter. */
  const nums = (key: string): number[] | null => (Array.isArray(cam?.params[key]) ? (cam!.params[key] as number[]) : null);
  const str = (key: string): string | null => (typeof cam?.params[key] === "string" ? (cam!.params[key] as string) : null);
  const n0 = (key: string, fallback: number) => nums(key)?.[0] ?? fallback;

  // The camera does not report the per-output tools (4.1) or overlays (3.0): the panel keeps what it set.
  const [tools, setTools] = useState<Record<Output, number>>({ lcd: 0, hdmi: 0 });
  const [overlays, setOverlays] = useState<Record<Output, number>>({ lcd: 0, hdmi: 0 });
  const tool = (out: Output, bit: number, on: boolean) => {
    const bits = on ? tools[out] | bit : tools[out] & ~bit;
    setTools({ ...tools, [out]: bits });
    send(4, 1, 2, [bits, TARGET_DISPLAYS[out]]);
  };
  const overlay = (out: Output, bit: number, on: boolean) => {
    const bits = on ? overlays[out] | bit : overlays[out] & ~bit;
    setOverlays({ ...overlays, [out]: bits });
    send(3, 0, 2, [bits, TARGET_DISPLAYS[out]]);
  };

  const status = cam?.status ?? 0;
  const flags = (Object.entries(BMD_STATUS_FLAGS) as [string, number][]).filter(([, bit]) => status & bit).map(([k]) => k);
  const recording = nums("10.1")?.[0] === 2;
  const wb = nums("1.2") ?? [5600, 0];
  const codec = nums("10.0");
  const guides = nums("3.3") ?? [0, 100, 0, 0];
  const focusAssist = nums("4.5") ?? [0, 0];
  const take = nums("12.3") ?? [1, -1];
  const tags = nums("12.1") ?? [-1, 0, 1];
  const params = Object.entries(cam?.params ?? {}).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

  return (
    <Panel label="Camera" width="440px">
      <PanelHead title={f.label}><IconButton icon="close" label="Close" onClick={onClose} /></PanelHead>
      <PanelBody>
        <p class="meta">{`Blackmagic Pocket Cinema Camera 6K · ${f.address}${cam?.protocolVersion ? ` · protocol ${cam.protocolVersion}` : ""}`}</p>
        <Banner kind={ready ? "ok" : live?.link === "failed" ? "warn" : "info"} icon="video-outline"
          title={ready ? `${recording ? "Recording" : "Connected"}${cam?.timecode ? ` · ${cam.timecode}` : ""}` : live?.link === "failed" ? live.error ?? "Cannot connect" : proxy.proxy ? "Connecting…" : "No proxy"}
          meta={flags.length ? flags.join(" · ") : "No status yet"} />
        {!ready && <p class="meta">First connection: the camera shows a 6-digit PIN in its Bluetooth menu; type it into the pairing dialog on the proxy phone. Bluetooth must be on in the camera's Setup menu.</p>}

        <fieldset class="devices-controls" disabled={!ready}>
          <div class="btn-row">
            <Button icon={recording ? "stop" : "record"} kind={recording ? "danger" : "primary"} onClick={() => send(10, 1, 1, [recording ? 0 : 2, 0, 0, 0, 0])}>{recording ? "Stop recording" : "Record"}</Button>
            <Button size="sm" kind="secondary" icon="camera-iris" onClick={() => send(10, 3, 0, [])}>Still</Button>
          </div>

          <Section title="Exposure" open>
            <Field as="div" label="ISO"><Select label="ISO" value={String(n0("1.14", 800))} onChange={(v) => send(1, 14, 3, [Number(v)])} options={ISO.map((i) => ({ value: String(i), label: String(i) }))} /></Field>
            <Field as="div" label="Shutter angle"><Select label="Shutter angle" value={String(n0("1.11", 18000) / 100)} onChange={(v) => send(1, 11, 3, [Math.round(Number(v) * 100)])} options={ANGLES.map((a) => ({ value: String(a), label: `${a}°` }))} /></Field>
            <Field label="Shutter speed" help="1/x of a second; the camera uses angle or speed as set in its menu."><Input sm unit="1/x" inputMode="numeric" boxStyle={{ width: "120px" }} value={String(n0("1.12", 50))} onChange={(e) => { const v = Math.round(Number((e.target as HTMLInputElement).value)); if (v > 0) send(1, 12, 3, [v]); }} /></Field>
            <Field as="div" label="Auto exposure"><Select label="Auto exposure mode" value={String(n0("1.10", 0))} onChange={(v) => send(1, 10, 1, [Number(v)])} options={AE_MODES.map((l, i) => ({ value: String(i), label: l }))} /></Field>
          </Section>

          <Section title="White balance" open>
            <Range label="White" value={wb[0]} min={2500} max={10000} step={50} format={(x) => `${x} K`} onChange={(x) => send(1, 2, 2, [x, wb[1] ?? 0])} />
            <Range label="Tint" value={wb[1] ?? 0} min={-50} max={50} step={1} format={(x) => (x > 0 ? `+${x}` : String(x))} onChange={(x) => send(1, 2, 2, [wb[0], x])} />
            <div class="btn-row">
              <Button size="sm" kind="secondary" onClick={() => send(1, 3, 0, [])}>Auto white balance</Button>
              <Button size="sm" kind="secondary" onClick={() => send(1, 4, 0, [])}>Restore auto WB</Button>
            </div>
          </Section>

          <Section title="Lens">
            <Range label="Iris" value={n0("0.3", 0.5)} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)} %`} onChange={(x) => send(0, 3, 128, [x])} />
            <Range label="Focus" value={n0("0.0", 0.5)} min={0} max={1} step={0.005} format={(x) => (x <= 0.001 ? "near" : x >= 0.999 ? "far" : `${Math.round(x * 100)} %`)} onChange={(x) => send(0, 0, 128, [x])} />
            <Range label="Zoom" value={n0("0.8", 0)} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)} %`} onChange={(x) => send(0, 8, 128, [x])} />
            <div class="btn-row">
              <Button size="sm" kind="secondary" onClick={() => send(0, 1, 0, [])}>Autofocus</Button>
              <Button size="sm" kind="secondary" onClick={() => send(0, 5, 0, [])}>Auto iris</Button>
            </div>
            <Checkbox checked={!!n0("0.6", 0)} onClick={() => send(0, 6, 0, [n0("0.6", 0) ? 0 : 1])}>Optical image stabilisation</Checkbox>
            <p class="meta">Iris, focus and zoom need an electronic lens; the values run 0 (open, near, wide) to 1.</p>
          </Section>

          <Section title="Image and codec">
            <div class="devices-field"><span class="section-title">Dynamic range</span>
              <Seg label="Dynamic range" value={String(n0("1.7", 0))} onChange={(v) => send(1, 7, 1, [Number(v)])} options={DYNAMIC_RANGE.map((l, i) => ({ id: String(i), label: l }))} /></div>
            <div class="devices-field"><span class="section-title">Sharpening</span>
              <Seg label="Sharpening" value={String(n0("1.8", 0))} onChange={(v) => send(1, 8, 1, [Number(v)])} options={SHARPENING.map((l, i) => ({ id: String(i), label: l }))} /></div>
            <Field as="div" label="Codec"><Select label="Codec" value={codec ? `${codec[0]}.${codec[1]}` : ""} onChange={(v) => { const [a, b] = v.split(".").map(Number); send(10, 0, 1, [a, b]); }}
              options={[...(codec && !CODECS.some((c) => `${c.v[0]}.${c.v[1]}` === `${codec[0]}.${codec[1]}`) ? [{ value: `${codec[0]}.${codec[1]}`, label: `Other (${codec.join(", ")})` }] : []), ...(!codec ? [{ value: "", label: "Not reported" }] : []), ...CODECS.map((c) => ({ value: `${c.v[0]}.${c.v[1]}`, label: c.label }))]} /></Field>
            {nums("1.9") && <p class="meta">{`Recording format: ${nums("1.9")![2]} × ${nums("1.9")![3]} at ${nums("1.9")![0]} fps`}</p>}
          </Section>

          <Section title="Monitoring per output" open>
            <table class="camera-outputs">
              <thead><tr><th /> {OUTPUTS.map((o) => <th key={o.id}>{o.label}</th>)}</tr></thead>
              <tbody>
                {([["Zebra", TOOL_BITS.zebra], ["Focus assist", TOOL_BITS.focusAssist], ["False colour", TOOL_BITS.falseColor]] as const).map(([label, bit]) => (
                  <tr key={label}><td>{label}</td>{OUTPUTS.map((o) => <td key={o.id}><Checkbox checked={!!(tools[o.id] & bit)} onClick={() => tool(o.id, bit, !(tools[o.id] & bit))}>{""}</Checkbox></td>)}</tr>
                ))}
                {([["Status overlay", 0x1], ["Frame guides", 0x2]] as const).map(([label, bit]) => (
                  <tr key={label}><td>{label}</td>{OUTPUTS.map((o) => <td key={o.id}><Checkbox checked={!!(overlays[o.id] & bit)} onClick={() => overlay(o.id, bit, !(overlays[o.id] & bit))}>{""}</Checkbox></td>)}</tr>
                ))}
              </tbody>
            </table>
            <p class="meta">The camera does not report these, so the ticks show what was set from here (all off at first).</p>
            <Range label="Zebra level" value={n0("4.2", 0.95)} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)} %`} onChange={(x) => send(4, 2, 128, [x])} />
            <Range label="Peaking level" value={n0("4.3", 0.5)} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)} %`} onChange={(x) => send(4, 3, 128, [x])} />
            <div class="two-col">
              <Field as="div" label="Focus assist"><Select label="Focus assist method" value={String(focusAssist[0])} onChange={(v) => send(4, 5, 1, [Number(v), focusAssist[1]])} options={FOCUS_METHOD.map((l, i) => ({ value: String(i), label: l }))} /></Field>
              <Field as="div" label="Line colour"><Select label="Focus line colour" value={String(focusAssist[1])} onChange={(v) => send(4, 5, 1, [focusAssist[0], Number(v)])} options={FOCUS_COLOUR.map((l, i) => ({ value: String(i), label: l }))} /></Field>
            </div>
            <div class="two-col">
              <Field as="div" label="Frame guide"><Select label="Frame guide" value={String(guides[0])} onChange={(v) => send(3, 3, 1, [Number(v), guides[1], guides[2], guides[3]])} options={GUIDES.map((l, i) => ({ value: String(i), label: l }))} /></Field>
              <Field label="Safe area"><Input sm unit="%" inputMode="numeric" value={String(guides[2])} onChange={(e) => { const v = Math.round(Number((e.target as HTMLInputElement).value)); if (v >= 0 && v <= 100) send(3, 3, 1, [guides[0], guides[1], v, guides[3]]); }} /></Field>
            </div>
            <Range label="Guide opacity" value={guides[1]} min={0} max={100} step={1} format={(x) => `${x} %`} onChange={(x) => send(3, 3, 1, [guides[0], x, guides[2], guides[3]])} />
            <div class="btn-row">
              {([["Thirds", 1], ["Cross", 2], ["Centre dot", 4], ["Horizon", 8]] as const).map(([l, bit]) => (
                <Checkbox key={l} checked={!!(guides[3] & bit)} onClick={() => send(3, 3, 1, [guides[0], guides[1], guides[2], guides[3] ^ bit])}>{l}</Checkbox>
              ))}
            </div>
            <Range label="Display brightness" value={n0("4.0", 0.5)} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)} %`} onChange={(x) => send(4, 0, 128, [x])} />
            <div class="btn-row">
              <Button size="sm" kind="secondary" onClick={() => send(4, 4, 1, [n0("4.4", 0) ? 0 : 30])}>{n0("4.4", 0) ? "Colour bars off" : "Colour bars (30 s)"}</Button>
            </div>
          </Section>

          <Section title="Colour correction">
            {([["Lift", 8, 0, -2, 2, 0], ["Gamma", 8, 1, -4, 4, 0], ["Gain", 8, 2, 0, 15.99, 1], ["Offset", 8, 3, -8, 8, 0]] as const).map(([name, c, p, lo, hi, def]) => {
              const v = nums(`${c}.${p}`) ?? [def, def, def, def];
              return (
                <div key={name} class="devices-field">
                  <span class="section-title">{name}</span>
                  {(["Red", "Green", "Blue", "Luma"] as const).map((ch, i) => (
                    <Range key={ch} label={ch} value={v[i] ?? def} min={lo} max={hi} step={0.01} format={fmt} onChange={(x) => send(c, p, 128, v.map((y, j) => (j === i ? x : y ?? def)))} />
                  ))}
                </div>
              );
            })}
            {(() => { const v = nums("8.4") ?? [0.5, 1]; return <>
              <Range label="Contrast pivot" value={v[0]} min={0} max={1} step={0.01} format={fmt} onChange={(x) => send(8, 4, 128, [x, v[1]])} />
              <Range label="Contrast" value={v[1]} min={0} max={2} step={0.01} format={fmt} onChange={(x) => send(8, 4, 128, [v[0], x])} /></>; })()}
            {(() => { const v = nums("8.6") ?? [0, 1]; return <>
              <Range label="Hue" value={v[0]} min={-1} max={1} step={0.01} format={fmt} onChange={(x) => send(8, 6, 128, [x, v[1]])} />
              <Range label="Saturation" value={v[1]} min={0} max={2} step={0.01} format={fmt} onChange={(x) => send(8, 6, 128, [v[0], x])} /></>; })()}
            <Range label="Luma mix" value={n0("8.5", 1)} min={0} max={1} step={0.01} format={fmt} onChange={(x) => send(8, 5, 128, [x])} />
            <div class="btn-row"><Button size="sm" kind="secondary" onClick={() => send(8, 7, 0, [])}>Reset colour correction</Button></div>
          </Section>

          <Section title="Audio">
            <Field as="div" label="Input"><Select label="Audio input" value={String(n0("2.4", 0))} onChange={(v) => send(2, 4, 1, [Number(v)])} options={AUDIO_INPUT.map((l, i) => ({ value: String(i), label: l }))} /></Field>
            {(() => { const v = nums("2.5") ?? [0.5, 0.5]; return <>
              <Range label="Input level ch 1" value={v[0]} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)} %`} onChange={(x) => send(2, 5, 128, [x, v[1]])} />
              <Range label="Input level ch 2" value={v[1]} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)} %`} onChange={(x) => send(2, 5, 128, [v[0], x])} /></>; })()}
            <Range label="Headphone level" value={n0("2.1", 0.5)} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)} %`} onChange={(x) => send(2, 1, 128, [x])} />
            <Range label="Headphone mix" value={n0("2.2", 0.5)} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)} %`} onChange={(x) => send(2, 2, 128, [x])} />
            <Range label="Speaker level" value={n0("2.3", 0.5)} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)} %`} onChange={(x) => send(2, 3, 128, [x])} />
            <Checkbox checked={!!n0("2.6", 0)} onClick={() => send(2, 6, 0, [n0("2.6", 0) ? 0 : 1])}>Phantom power</Checkbox>
          </Section>

          <Section title="Slate">
            <div class="two-col">
              <Field label="Scene"><Input sm value={str("12.2") ?? ""} maxLength={5} onChange={(e) => send(12, 2, 5, (e.target as HTMLInputElement).value)} /></Field>
              <Field label="Take"><Input sm inputMode="numeric" value={String(take[0])} onChange={(e) => { const v = Math.round(Number((e.target as HTMLInputElement).value)); if (v >= 1 && v <= 99) send(12, 3, 1, [v, take[1] ?? -1]); }} /></Field>
              <Field label="Reel"><Input sm inputMode="numeric" value={String(n0("12.0", 1))} onChange={(e) => { const v = Math.round(Number((e.target as HTMLInputElement).value)); if (v >= 0 && v <= 999) send(12, 0, 2, [v]); }} /></Field>
              <Field as="div" label="Shot"><Select label="Shot tag" value={String(tags[0])} onChange={(v) => send(12, 1, 1, [Number(v), tags[1], tags[2]])} options={SHOT_TAGS.map((l, i) => ({ value: String(i - 1), label: l }))} /></Field>
            </div>
            <div class="btn-row">
              <Seg label="Interior or exterior" value={String(tags[1])} onChange={(v) => send(12, 1, 1, [tags[0], Number(v), tags[2]])} options={[{ id: "1", label: "INT" }, { id: "0", label: "EXT" }]} />
              <Seg label="Day or night" value={String(tags[2])} onChange={(v) => send(12, 1, 1, [tags[0], tags[1], Number(v)])} options={[{ id: "1", label: "Day" }, { id: "0", label: "Night" }]} />
              <Button size="sm" kind="secondary" icon="star-outline" onClick={() => send(12, 4, 0, [])}>Good take</Button>
            </div>
            {([["Camera id", 5, 28], ["Operator", 6, 28], ["Director", 7, 27], ["Project", 8, 28]] as const).map(([label, p, max]) => (
              <Field key={label} label={label}><Input sm value={str(`12.${p}`) ?? ""} maxLength={max} onChange={(e) => send(12, p, 5, (e.target as HTMLInputElement).value)} /></Field>
            ))}
          </Section>

          <Section title="Tally">
            <Range label="Tally brightness" value={n0("5.0", 1)} min={0} max={1} step={0.01} format={(x) => `${Math.round(x * 100)} %`} onChange={(x) => send(5, 0, 128, [x])} />
          </Section>
        </fieldset>

        <Section title={`Reported by the camera (${params.length})`}>
          {params.length === 0 && <p class="meta">Nothing yet: the camera reports its settings after pairing.</p>}
          <dl class="f-facts">{params.map(([k, v]) => <><dt key={`${k}-k`} title={k}>{CCU_PARAMS[k]?.name ?? `Undocumented ${k}`}</dt><dd key={`${k}-v`} class="num">{typeof v === "string" ? v : v.map(fmt).join(", ")}</dd></>)}</dl>
        </Section>
        <Section title="Incoming log">
          <pre class="camera-log">{(cam?.log ?? []).join("\n") || "—"}</pre>
        </Section>
        {children}
      </PanelBody>
    </Panel>
  );
}

function Section({ title, open, children }: { title: string; open?: boolean; children: ComponentChildren }) {
  return (
    <details class="camera-section" open={open}>
      <summary class="section-title">{title}</summary>
      <div class="devices-field">{children}</div>
    </details>
  );
}
