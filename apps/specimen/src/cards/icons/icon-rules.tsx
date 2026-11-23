// Port of guidelines/icon-rules.card.html.
import { Icon, type IconName } from "@openclapper/design";

const grid = "repeating-linear-gradient(0deg,var(--border-divider) 0 1px,transparent 1px 6.667px),repeating-linear-gradient(90deg,var(--border-divider) 0 1px,transparent 1px 6.667px)";

function Big({ name }: { name: IconName }) {
  return (
    <span style={{ position: "relative", width: 160, height: 160, flex: "none", background: grid, outline: "1px solid var(--border-control)" }}>
      <span style={{ position: "absolute", inset: 13.33, border: "1px dashed var(--accent)" }} />
      <Icon name={name} size={160} style={{ position: "absolute", inset: 0 }} />
    </span>
  );
}

export default function Card() {
  return (
    <div className="one" style={{ display: "flex", gap: 16, alignItems: "center" }}>
      <Big name="camera" />
      <Big name="folder" />
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.5 }}>
        <li>Source: Tabler Icons v3.51.0, outline set, MIT. Over 5,000 icons at tabler.io/icons.</li>
        <li>24 × 24 grid, 2 px live-area padding, round caps and joins, no fills.</li>
        <li>Stroke follows size so lines stay crisp: 2.5 at 12 px, 2 at 16 px, 1.75 at 20 px.</li>
        <li>Use the OpenClapper alias (close, image, warning), not the tabler name, in components.</li>
        <li>To add one: copy the outline markup into glyphs.js under a short semantic name, and save the SVG in assets/icons.</li>
        <li>Never mix in filled Tabler variants or another set.</li>
        <li>currentColor only; sizes 12, 16, 20 px.</li>
      </ul>
    </div>
  );
}
