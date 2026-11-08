import { BMD_STATUS_FLAGS, CCU_PARAMS, TARGET_DISPLAYS, TOOL_BITS, type CcuMessage, type FixtureLive } from "@openclapper/vocab";
import { Banner, Button, IconButton, Panel, PanelBody, PanelHead } from "@openclapper/ui";
import type { ServerFixture } from "../api";
import type { LightProxy } from "../lightProxy";

/**
 * A Blackmagic camera in Devices (#318), step 1: connection and pairing state, timecode, every
 * parameter the camera reports, the raw incoming log, and the per-output test: does a false colour
 * or Display LUT write reach the HDMI feed, the LCD, or both, and does the camera take an output target?
 */
export function CameraPanel({ f, live, proxy, onClose, children }: { f: ServerFixture; live: FixtureLive | undefined; proxy: LightProxy; onClose: () => void; children?: preact.ComponentChildren }) {
  const cam = live?.telemetry?.camera;
  const ready = live?.link === "ready";
  const send = (message: CcuMessage) => proxy.send(f.id, { op: "ccu", message });
  const status = cam?.status ?? 0;
  const tools = Array.isArray(cam?.params["4.1"]) ? (cam!.params["4.1"] as number[]) : null;
  const lut = Array.isArray(cam?.params["1.15"]) ? (cam!.params["1.15"] as number[]) : null;
  const toolBits = tools?.[0] ?? 0;
  const falseColour = (on: boolean, target?: number) =>
    send({ category: 4, parameter: 1, type: 2, operation: 0, data: [on ? toolBits | TOOL_BITS.falseColor : toolBits & ~TOOL_BITS.falseColor, ...(target !== undefined ? [target] : [])] });
  const displayLut = (on: boolean) => send({ category: 1, parameter: 15, type: 1, operation: 0, data: [lut?.[0] ?? 1, on ? 1 : 0] });
  const record = (on: boolean) => send({ category: 10, parameter: 1, type: 1, operation: 0, data: [on ? 2 : 0, 0, 0, 0, 0] });
  const flags = (Object.entries(BMD_STATUS_FLAGS) as [string, number][]).filter(([, bit]) => status & bit).map(([k]) => k);
  const params = Object.entries(cam?.params ?? {}).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  return (
    <Panel label="Camera" width="420px">
      <PanelHead title={f.label}><IconButton icon="close" label="Close" onClick={onClose} /></PanelHead>
      <PanelBody>
        <p class="meta">{`Blackmagic Pocket Cinema Camera 6K · ${f.address}${cam?.protocolVersion ? ` · protocol ${cam.protocolVersion}` : ""}`}</p>
        <Banner kind={ready ? "ok" : live?.link === "failed" ? "warn" : "info"} icon="video-outline"
          title={ready ? `Connected${cam?.timecode ? ` · ${cam.timecode}` : ""}` : live?.link === "failed" ? live.error ?? "Cannot connect" : proxy.proxy ? "Connecting…" : "No proxy"}
          meta={flags.length ? flags.join(" · ") : "No status yet"} />
        <p class="meta">First connection: the camera shows a 6-digit PIN in its Bluetooth menu; type it into the pairing dialog on the proxy phone. Bluetooth must be on in the camera's Setup menu.</p>

        <div class="devices-field">
          <span class="section-title">Record</span>
          <div class="btn-row">
            <Button size="sm" icon="record" disabled={!ready} onClick={() => record(true)}>Start</Button>
            <Button size="sm" kind="secondary" icon="stop" disabled={!ready} onClick={() => record(false)}>Stop</Button>
          </div>
        </div>

        <div class="devices-field devices-manage">
          <span class="section-title">Per-output test: false colour and Display LUT</span>
          <p class="meta">1. On the camera, switch false colour on the LCD page, then on the HDMI page, and watch 4.1 below: one value means the camera has no output target, two values mean the second names the outputs (1 LCD, 2 HDMI). Do the same with Display 3D LUT and 1.15.</p>
          <p class="meta">{`Now: 4.1 = ${tools ? `[${tools.join(", ")}]` : "not reported"} · 1.15 = ${lut ? `[${lut.join(", ")}]` : "not reported"}`}</p>
          <p class="meta">2. Write it from here and watch both the LCD and the HDMI monitor:</p>
          <div class="btn-row">
            <Button size="sm" kind="secondary" disabled={!ready} onClick={() => falseColour(true)}>False colour on</Button>
            <Button size="sm" kind="secondary" disabled={!ready} onClick={() => falseColour(false)}>off</Button>
          </div>
          <div class="btn-row">
            <Button size="sm" kind="secondary" disabled={!ready} onClick={() => falseColour(true, TARGET_DISPLAYS.hdmi)}>On, HDMI only</Button>
            <Button size="sm" kind="secondary" disabled={!ready} onClick={() => falseColour(false, TARGET_DISPLAYS.hdmi)}>Off, HDMI only</Button>
          </div>
          <div class="btn-row">
            <Button size="sm" kind="secondary" disabled={!ready} onClick={() => falseColour(true, TARGET_DISPLAYS.lcd)}>On, LCD only</Button>
            <Button size="sm" kind="secondary" disabled={!ready} onClick={() => falseColour(false, TARGET_DISPLAYS.lcd)}>Off, LCD only</Button>
          </div>
          <div class="btn-row">
            <Button size="sm" kind="secondary" disabled={!ready} onClick={() => displayLut(true)}>Display LUT on</Button>
            <Button size="sm" kind="secondary" disabled={!ready} onClick={() => displayLut(false)}>off</Button>
          </div>
        </div>

        <div class="devices-field devices-manage">
          <span class="section-title">{`Reported (${params.length})`}</span>
          {params.length === 0 && <p class="meta">Nothing yet: the camera reports its settings after pairing.</p>}
          <dl class="f-facts">{params.map(([k, v]) => <><dt key={`${k}-k`} title={k}>{CCU_PARAMS[k]?.name ?? `Undocumented ${k}`}</dt><dd key={`${k}-v`} class="num">{typeof v === "string" ? v : v.map((x) => (Number.isInteger(x) ? x : x.toFixed(3))).join(", ")}</dd></>)}</dl>
        </div>

        <div class="devices-field devices-manage">
          <span class="section-title">Incoming log</span>
          <pre class="camera-log">{(cam?.log ?? []).join("\n") || "—"}</pre>
        </div>
        {children}
      </PanelBody>
    </Panel>
  );
}
