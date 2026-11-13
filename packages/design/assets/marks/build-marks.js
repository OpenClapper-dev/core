// Mark generator. Single source for every mark file. Run with the project's script runner (see readme, Marks).
// Geometry on a 64-unit tile: a clapper board whose body runs off the bottom-right edge, a hinge hole,
// and a striped stick rising to the right. Environment = colour AND board treatment:
// every environment uses the same solid board; only the colour changes. Client = a Tabler glyph cut from the board.
function makeMarks(GLYPHS) {
  const ENV = { production: '#1E3FBF', staging: '#B8471F', development: '#3B7A1A' };
  const CLIENT = { mark: null, studio: 'window', phone: 'mobile', admin: 'lock', home: null };
  let uid = 0;
  function content(env, glyph, small) {
    const id = 'm' + (uid++);
    const board = 'M18 30h112v100H14V34a4 4 0 0 1 4-4z';
    let mask = '<rect x="-200" y="-200" width="600" height="600" fill="black"/><path d="' + board + '" fill="white"/>';
    mask += '<circle cx="19.5" cy="35.5" r="' + (small ? 2.8 : 2.3) + '" fill="black"/>';
    const g = glyph && !small ? '<g transform="translate(29 37) scale(0.9167)" fill="none" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' + GLYPHS[glyph][1] + '</g>' : '';
    if (g) mask += g.replace('<g ', '<g stroke="black" ');
    let blocks = '';
    for (let i = 0; i < 9; i++) { const x = 14 + i * 13; blocks += 'M' + (x + 3.5) + ' 19h9.5l-3.5 8H' + x + (i === 0 ? 'V22.5z' : 'z'); }
    return '<defs><mask id="' + id + '" maskUnits="userSpaceOnUse" x="-200" y="-200" width="600" height="600">' + mask + '</mask></defs>' +
      '<rect x="-200" y="-200" width="600" height="600" fill="white" mask="url(#' + id + ')"/>' +
      '<path transform="rotate(-18 14 27)" fill="white" d="' + blocks + '"/>';
  }
  function tile(env, client, o = {}) {
    const size = o.size || 64, r = o.radius || 0, sc = o.scale || 1, cid = 'c' + (uid++);
    const t = sc === 1 ? '' : ' transform="translate(' + 32 * (1 - sc) + ' ' + 32 * (1 - sc) + ') scale(' + sc + ')"';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 64 64"><defs><clipPath id="' + cid + '"><rect width="64" height="64" rx="' + r + '"/></clipPath></defs><g clip-path="url(#' + cid + ')"><rect width="64" height="64" fill="' + ENV[env] + '"/><g' + t + '>' + content(env, CLIENT[client], o.small) + '</g></g></svg>\n';
  }
  function adaptive(env, layer) {
    if (layer === 'background') return '<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108"><rect width="108" height="108" fill="' + ENV[env] + '"/></svg>\n';
    const cid = 'a' + (uid++);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="108" height="108" viewBox="0 0 108 108"><defs><clipPath id="' + cid + '"><rect width="108" height="108"/></clipPath></defs><g clip-path="url(#' + cid + ')"><g transform="translate(18 18) scale(1.125)">' + content(env, 'mobile') + '</g></g></svg>\n';
  }
  // Wordmark and lockup are emitted with live text for previews. The shipped files in assets/marks are outlined
  // from AtkinsonHyperlegibleNext-700 (fontkit, kerning on, same size/tracking); re-outline after regenerating.
  function lockup(fill) {
    const m = tile('production', 'mark', { size: 56, radius: 12 }).replace(/^<svg xmlns="[^"]+" width="56" height="56"/, '<svg x="0" y="0" width="56" height="56"');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="372" height="56" viewBox="0 0 372 56">' + m.trim() + '<text x="72" y="41" font-family="Atkinson Hyperlegible Next, sans-serif" font-weight="700" font-size="40" letter-spacing="-0.4" fill="' + fill + '">OpenClapper</text></svg>\n';
  }
  function wordmark(fill) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="56" viewBox="0 0 300 56"><text x="0" y="41" font-family="Atkinson Hyperlegible Next, sans-serif" font-weight="700" font-size="44" letter-spacing="-0.44" fill="' + fill + '">OpenClapper</text></svg>\n';
  }
  return { ENV, CLIENT, tile, adaptive, lockup, wordmark };
}

// Exported so a script can regenerate the marks (pass GLYPHS from src/core/glyphs.ts); the files in this folder are its output.
export { makeMarks };
