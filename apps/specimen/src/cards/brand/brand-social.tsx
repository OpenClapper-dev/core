// Port of guidelines/brand-social.card.html.
import social from "@openclapper/design/assets/marks/png/social-preview-1200x630.png";
import favProduction from "@openclapper/design/assets/marks/png/studio-production-favicon-16.png";
import favStaging from "@openclapper/design/assets/marks/png/studio-staging-favicon-16.png";
import favDevelopment from "@openclapper/design/assets/marks/png/studio-development-favicon-16.png";

const tab = { display: "flex", alignItems: "center", gap: 8, height: 28, padding: "0 10px", border: "1px solid var(--border-control)", borderRadius: "6px 6px 0 0", fontSize: 12, width: 170 };

export default function Card() {
  return (
    <div className="one" style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "start" }}>
      <img src={social} style={{ display: "block", width: "100%", height: "auto", border: "1px solid var(--border-divider)" }} alt="Social preview" />
      <div style={{ display: "grid", gap: 10 }}>
        {[favProduction, favStaging, favDevelopment].map((src) => (
          <span key={src} style={tab}><img style={{ display: "block" }} src={src} width={16} height={16} alt="" />OpenClapper Studio</span>
        ))}
        <span className="oc-meta">Browser tabs · 16 px</span>
      </div>
    </div>
  );
}
