// Port of guidelines/over-content.card.html. The grey gradient stands in for a photo (data, not chrome).
const TOKENS = ["photo-bg", "over-ink", "over-paper", "over-mask", "over-frame", "over-human", "over-rec", "over-pin"];
const tag = { position: "absolute", background: "var(--over-ink)", color: "var(--over-paper)", padding: "3px 4px", borderRadius: 2 } as const;

export default function Card() {
  return (
    <div className="one" style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16 }}>
      <div style={{ position: "relative", height: 120, background: "var(--photo-bg)" }}>
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg,#6a6a6a,#262626 70%)" }} />
        <div style={{ position: "absolute", inset: 0, border: "16px solid var(--over-mask)" }} />
        <div style={{ position: "absolute", inset: 16, border: "1px solid var(--over-frame)", outline: "1px solid var(--over-frame-outline)" }} />
        <span style={{ ...tag, left: 20, bottom: 20, font: "500 10px/1 var(--font-mono)" }}>24 mm</span>
        <span style={{ ...tag, right: 20, top: 20, display: "flex", alignItems: "center", gap: 4, font: "700 10px/1 var(--font-sans)" }}>
          <i style={{ width: 7, height: 7, borderRadius: 9, background: "var(--over-rec)" }} />REC
        </span>
        <div style={{ position: "absolute", left: 70, top: 40, width: 60, height: 44, border: "1px dashed var(--over-human)" }} />
      </div>
      <div className="sw" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
        {TOKENS.map((t) => <div key={t}><i style={{ background: `var(--${t})` }} /><b>{t}</b></div>)}
      </div>
    </div>
  );
}
