// Port of guidelines/numbers.card.html. PropertyList, Table and StatusBar are not in @openclapper/design yet, so their
// markup is drawn here with the same oc- classes. The source's `.as-mono` rule (mono on .oc-tnum, numeric cells, status
// bar) is applied inline, and the table's own font and padding are set inline because the specimen's `.sp-card table`
// helper would otherwise override `.oc-table`.
import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { Icon } from "@openclapper/design";
import { L } from "../../kit";

const box = { border: "1px solid var(--border-divider)", borderRadius: 6, overflow: "hidden", background: "var(--surface)" };
const mono = (on: boolean) => (on ? { fontFamily: "var(--font-mono)" } : {});

function Row({ label, value, unit, asMono }: { label: string; value: string; unit?: string; asMono: boolean }) {
  return (
    <div className="oc-props__row">
      <span className="oc-props__label" title={label}>{label}</span>
      <span className="oc-props__value oc-props__value--wrap is-num oc-tnum" style={mono(asMono)} title={value + (unit ? " " + unit : "")}>
        {value}{unit && <span className="oc-props__unit">{unit}</span>}
      </span>
    </div>
  );
}

const ROWS = [{ id: "a", n: "Harbour gate", lat: "53.5461", s: "12" }, { id: "b", n: "Old brewery", lat: "53.5513", s: "7" }, { id: "c", n: "Ferry ramp", lat: "53.5440", s: "119" }];
const cell = { padding: "0 var(--space-4)" };

function Th({ num = false, asMono = false, children }: { num?: boolean; asMono?: boolean; children: ComponentChildren }) {
  return <th className={num ? "is-num" : undefined} style={{ ...cell, fontWeight: "var(--weight-medium)", ...mono(num && asMono) }}>{children}</th>;
}

function Col({ asMono }: { asMono?: boolean }) {
  const isMono = !!asMono;
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState<number[] | null>(null);
  useLayoutEffect(() => {
    let live = true;
    const measure = () => {
      const el = ref.current;
      if (!el || !live) return;
      setW([...el.querySelectorAll(".oc-props__value")].map((e) => {
        const r = document.createRange();
        r.selectNodeContents(e);
        return Math.round(r.getBoundingClientRect().width);
      }));
    };
    measure();
    void document.fonts.ready.then(measure);
    return () => { live = false; };
  }, []);
  return (
    <div ref={ref}>
      <L>{isMono ? "Atkinson Hyperlegible Mono" : "Atkinson Next · tabular-nums"}</L>
      <div style={{ ...box, width: 240 }}>
        <div className="oc-props">
          <section className="oc-props__section">
            <button type="button" className="oc-props__head" aria-expanded="true"><Icon name="chevron-down" size={12} /><Icon name="pin" /><span>Position</span></button>
            <div className="oc-props__body">
              <Row label="Taken" value="12 Nov · 14:32:08" asMono={isMono} />
              <Row label="Latitude" value="52.5200° N" asMono={isMono} />
              <Row label="Longitude" value="13.4050° E" asMono={isMono} />
              <Row label="Focal length" value="24" unit="mm" asMono={isMono} />
            </div>
          </section>
        </div>
      </div>
      <p style={{ color: "var(--text-secondary)", font: "400 12px/1 var(--font-sans)", fontVariantNumeric: "tabular-nums", margin: "4px 0 10px" }}>{w ? "value widths: " + w.join(" · ") + " px" : " "}</p>
      <div style={box}>
        <table role="grid" className="oc-table" style={{ font: "var(--weight-regular) var(--font-size-md)/1 var(--font-sans)" }}>
          <thead><tr><Th>Location</Th><Th num asMono={isMono}>Lat °</Th><Th num asMono={isMono}>Shots</Th></tr></thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.id} aria-selected={false}>
                <td style={cell}>{r.n}</td>
                <td className="is-num" style={{ ...cell, ...mono(isMono) }}>{r.lat}</td>
                <td className="is-num" style={{ ...cell, ...mono(isMono) }}>{r.s}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div role="status" className="oc-statusbar" style={mono(isMono)}>24 items · <strong>2 selected</strong> · 48.2 MB</div>
      </div>
    </div>
  );
}

const rec = { display: "grid", gridTemplateColumns: "120px minmax(0,1fr) auto", gap: "4px 12px", marginTop: 6, font: "400 13px/1.35 var(--font-sans)", color: "var(--text)" };
const what = { fontWeight: 600 };
const cls = { color: "var(--text-secondary)" };

export default function Card() {
  return (
    <div className="half" data-theme="light" style={{ width: "100%" }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}><Col asMono /><Col /></div>
      <L>recommendation · applied in this version</L>
      <div style={rec}>
        <b style={what}>Property list</b><span>Sans, tabular. About 20 % narrower, so readouts fit a 240–260 px inspector; right alignment plus tabular figures keeps digits in columns.</span><span style={cls}>.oc-tnum</span>
        <b style={what}>Table</b><span>Sans, tabular for numeric columns. Mono only for codes, IDs, hashes and timecode (column <code>mono</code>).</span><span style={cls}>numeric / mono</span>
        <b style={what}>Status bar</b><span>Sans, tabular. It is a sentence of facts, not a readout.</span><span style={cls}>.oc-statusbar</span>
        <b style={what}>Stays mono</b><span>Timecode, the taskbar clock, camera readouts on the phone, live values that tick, keys in Kbd, file sizes and counts in meta lines, codes.</span><span style={cls}>.oc-num</span>
      </div>
    </div>
  );
}
