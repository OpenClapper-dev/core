// Port of guidelines/brand-sizes.card.html.
import studioProduction from "@openclapper/design/assets/marks/studio-production.svg";
import studioProductionSmall from "@openclapper/design/assets/marks/studio-production-small.svg";
import studioStaging from "@openclapper/design/assets/marks/studio-staging.svg";
import studioStagingSmall from "@openclapper/design/assets/marks/studio-staging-small.svg";
import studioDevelopment from "@openclapper/design/assets/marks/studio-development.svg";
import studioDevelopmentSmall from "@openclapper/design/assets/marks/studio-development-small.svg";
import maskProduction from "@openclapper/design/assets/marks/png/studio-production-icon-maskable-512.png";
import maskStaging from "@openclapper/design/assets/marks/png/studio-staging-icon-maskable-512.png";
import maskDevelopment from "@openclapper/design/assets/marks/png/studio-development-icon-maskable-512.png";
import bgProduction from "@openclapper/design/assets/marks/png/phone-production-adaptive-background-432.png";
import fgProduction from "@openclapper/design/assets/marks/png/phone-production-adaptive-foreground-432.png";
import bgStaging from "@openclapper/design/assets/marks/png/phone-staging-adaptive-background-432.png";
import fgStaging from "@openclapper/design/assets/marks/png/phone-staging-adaptive-foreground-432.png";
import bgDevelopment from "@openclapper/design/assets/marks/png/phone-development-adaptive-background-432.png";
import fgDevelopment from "@openclapper/design/assets/marks/png/phone-development-adaptive-foreground-432.png";

interface Env { id: string; full: string; small: string; mask: string; bg: string; fg: string }
const ENVS: Env[] = [
  { id: "production", full: studioProduction, small: studioProductionSmall, mask: maskProduction, bg: bgProduction, fg: fgProduction },
  { id: "staging", full: studioStaging, small: studioStagingSmall, mask: maskStaging, bg: bgStaging, fg: fgStaging },
  { id: "development", full: studioDevelopment, small: studioDevelopmentSmall, mask: maskDevelopment, bg: bgDevelopment, fg: fgDevelopment },
];
/** [label, drawn size, small glyph]: 512 and 192 are drawn at 72 to fit the card; below 48 the small glyph takes over. */
const SIZES: [label: string, px: number, small: boolean][] = [["512", 72, false], ["192", 72, false], ["64", 64, false], ["48", 48, false], ["32", 32, true], ["24", 24, true], ["16", 16, true]];

const c = { display: "grid", gap: 5, justifyItems: "center", font: "10px/1.2 var(--font-mono)", color: "var(--text-secondary)", textAlign: "center" } as const;
const layer = { display: "block", position: "absolute", left: -18, top: -18 } as const;

function Row({ env }: { env: Env }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(9,auto)", justifyContent: "start", gap: 14, alignItems: "end" }}>
      {SIZES.map(([label, px, small]) => (
        <span key={label} style={c}><img style={{ display: "block", borderRadius: "22%" }} src={small ? env.small : env.full} width={px} height={px} alt="" />{label}</span>
      ))}
      <span style={c}><img style={{ display: "block", borderRadius: "50%" }} src={env.mask} width={72} height={72} alt="" />maskable</span>
      <span style={c}>
        <span style={{ position: "relative", display: "block", width: 72, height: 72, borderRadius: "50%", overflow: "hidden" }}>
          <img style={layer} src={env.bg} width={108} height={108} alt="" />
          <img style={layer} src={env.fg} width={108} height={108} alt="" />
        </span>
        adaptive
      </span>
    </div>
  );
}

export default function Card() {
  return <div className="one" style={{ display: "grid", gap: 16 }}>{ENVS.map((e) => <Row key={e.id} env={e} />)}</div>;
}
