// Stand-in pictures for the prototype: small generated scenes, one per seed, so tiles differ and read as photographs
// or drawings at thumbnail size. They are placeholders until real example photos exist (docs/rewrite/02-optics.md).

const rnd = (seed: number) => { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); };
const uri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/** A photograph-like scene: sky, a horizon, a few masses. Seeds 11–19 harbour at dusk, 31–39 interiors, others daylight. */
function photo(seed: number): string {
  const r = rnd(seed);
  const interior = seed >= 31 && seed <= 39, dusk = seed >= 11 && seed <= 19;
  const [top, mid, ground] = interior ? ["#3a3430", "#6b5d50", "#2a2522"] : dusk ? ["#1f2a4a", "#d9824a", "#161a22"] : ["#7fa6c9", "#cfdbe2", "#4d5a45"];
  const h = 52 + Math.floor(r() * 16);
  let shapes = "";
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(r() * 150), w = 14 + Math.floor(r() * 34), ht = 10 + Math.floor(r() * (interior ? 60 : 36));
    shapes += `<rect x="${x}" y="${h - ht}" width="${w}" height="${ht}" fill="${interior ? "#8a7a68" : "#0d1016"}" opacity="${(0.35 + r() * 0.5).toFixed(2)}"/>`;
  }
  const glow = interior ? `<rect x="${20 + Math.floor(r() * 90)}" y="14" width="34" height="30" fill="#f1e2bd" opacity=".8"/>` : `<circle cx="${30 + Math.floor(r() * 100)}" cy="${h - 6}" r="${dusk ? 9 : 6}" fill="${dusk ? "#ffd7a1" : "#fff7df"}" opacity=".9"/>`;
  return uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${mid}"/></linearGradient></defs><rect width="160" height="${h}" fill="url(#g)"/>${glow}${shapes}<rect y="${h}" width="160" height="${120 - h}" fill="${ground}"/><rect y="${h}" width="160" height="${120 - h}" fill="${mid}" opacity=".18"/></svg>`);
}

/** A drawing on paper: a floor plan, a storyboard panel or a lighting diagram, by seed. */
function drawing(seed: number): string {
  const r = rnd(seed);
  const ink = "#1c1c1c";
  let body = "";
  if (seed === 61) body = `<rect x="22" y="18" width="116" height="84" fill="none" stroke="${ink}" stroke-width="3"/><path d="M80 18v40M80 74v28M22 60h34M104 60h34" stroke="${ink}" stroke-width="3" fill="none"/><path d="M56 60a16 16 0 0 1 16 -16" stroke="${ink}" stroke-width="1.5" fill="none"/><circle cx="112" cy="84" r="5" fill="#2f5fd0"/><path d="M112 84l-22-18" stroke="#2f5fd0" stroke-width="2"/>`;
  else if (seed === 64) body = `<circle cx="80" cy="60" r="10" fill="none" stroke="${ink}" stroke-width="2"/><path d="M30 26l28 22M130 30l-30 20M40 100l28-26" stroke="#c9541e" stroke-width="3"/><rect x="18" y="16" width="16" height="12" fill="#c9541e"/><rect x="128" y="20" width="16" height="12" fill="#c9541e"/><rect x="28" y="98" width="16" height="12" fill="#c9541e"/>`;
  else {
    for (let i = 0; i < 4; i++) body += `<path d="M${14 + r() * 30} ${30 + r() * 60} Q ${60 + r() * 40} ${10 + r() * 90} ${120 + r() * 26} ${30 + r() * 60}" fill="none" stroke="${ink}" stroke-width="${(1.2 + r() * 1.6).toFixed(1)}"/>`;
    body += `<circle cx="${50 + r() * 60}" cy="${44 + r() * 20}" r="9" fill="none" stroke="${ink}" stroke-width="2"/><rect x="6" y="6" width="148" height="108" fill="none" stroke="${ink}" stroke-width="2"/>`;
  }
  return uri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#f4f1ea"/>${body}</svg>`);
}

/** The picture for a seed: 61–69 are drawings, everything else a photograph. */
export const picture = (seed: number): string => (seed >= 61 && seed <= 69 ? drawing(seed) : photo(seed));
