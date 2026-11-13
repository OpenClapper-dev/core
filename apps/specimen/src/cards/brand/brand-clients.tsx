// Port of guidelines/brand-clients.card.html. The hex under each environment is the swatch's value, shown as data.
import markProduction from "@openclapper/design/assets/marks/mark-production.svg";
import markStaging from "@openclapper/design/assets/marks/mark-staging.svg";
import markDevelopment from "@openclapper/design/assets/marks/mark-development.svg";
import studioProduction from "@openclapper/design/assets/marks/studio-production.svg";
import studioStaging from "@openclapper/design/assets/marks/studio-staging.svg";
import studioDevelopment from "@openclapper/design/assets/marks/studio-development.svg";
import phoneProduction from "@openclapper/design/assets/marks/phone-production.svg";
import phoneStaging from "@openclapper/design/assets/marks/phone-staging.svg";
import phoneDevelopment from "@openclapper/design/assets/marks/phone-development.svg";
import adminProduction from "@openclapper/design/assets/marks/admin-production.svg";
import adminStaging from "@openclapper/design/assets/marks/admin-staging.svg";
import adminDevelopment from "@openclapper/design/assets/marks/admin-development.svg";
import homeProduction from "@openclapper/design/assets/marks/home-production.svg";
import homeStaging from "@openclapper/design/assets/marks/home-staging.svg";
import homeDevelopment from "@openclapper/design/assets/marks/home-development.svg";

const CLIENTS = ["Mark · org avatar", "Studio", "Phone app", "Admin board", "Home site"];
const ENVS: [name: string, hex: string, srcs: string[]][] = [
  ["Production", "#1E3FBF", [markProduction, studioProduction, phoneProduction, adminProduction, homeProduction]],
  ["Staging", "#B8471F", [markStaging, studioStaging, phoneStaging, adminStaging, homeStaging]],
  ["Development", "#3B7A1A", [markDevelopment, studioDevelopment, phoneDevelopment, adminDevelopment, homeDevelopment]],
];

const c = { display: "grid", gap: 5, justifyItems: "center", font: "12px/1.2 var(--font-mono)", color: "var(--text-secondary)", textAlign: "center" } as const;

export default function Card() {
  return (
    <div className="one">
      <div style={{ display: "grid", gap: 10, alignItems: "center", gridTemplateColumns: "110px repeat(5,1fr)" }}>
        <span />
        {CLIENTS.map((cl) => <span key={cl} style={c}>{cl}</span>)}
        {ENVS.map(([env, hex, srcs]) => [
          <span key={env} style={{ ...c, justifyItems: "start", textAlign: "left" }}><b style={{ color: "var(--text)", fontSize: 13 }}>{env}</b>{hex}</span>,
          ...srcs.map((src, i) => (
            <span key={src} style={c}><img style={{ display: "block", borderRadius: "22%" }} src={src} width={72} height={72} alt={`${CLIENTS[i]} ${env.toLowerCase()}`} /></span>
          )),
        ])}
      </div>
    </div>
  );
}
