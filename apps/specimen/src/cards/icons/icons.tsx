// Port of guidelines/icons.card.html. The glyph list comes from GLYPHS (every Tabler-sourced alias); the custom film
// glyphs are on the Film glyphs card.
import { GLYPHS, Icon, type IconName } from "@openclapper/design";
import { Pair } from "../../kit";

const NAMES = (Object.keys(GLYPHS) as IconName[]).filter((n) => GLYPHS[n][0] !== "custom");

function GlyphSet() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(10,1fr)", gap: 4 }}>
      {NAMES.map((n) => (
        <span key={n} title={`${n} · tabler ${GLYPHS[n][0]}`} style={{ display: "grid", placeItems: "center", height: 28, border: "1px solid var(--border-divider)", borderRadius: 3 }}>
          <Icon name={n} />
        </span>
      ))}
    </div>
  );
}

export default function Card() { return <Pair Demo={GlyphSet} />; }
