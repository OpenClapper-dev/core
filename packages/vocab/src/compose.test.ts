import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyDrawing, lookFilter, moveShape, NEUTRAL_LOOK, shapeBounds, simplifyPoints, validateDrawing, validatePresentation, type Shape } from "./compose.ts";
import { inlineText, markdownSummary, parseInline, parseMarkdown } from "./markdown.ts";

const base = { id: "a", color: "#FFD60A", width: 0.005, opacity: 1 };

test("drawing: an overlay needs a look, a sketch must not have one", () => {
  assert.equal(validateDrawing(emptyDrawing(true), true), null);
  assert.equal(validateDrawing(emptyDrawing(false), false), null);
  assert.match(validateDrawing(emptyDrawing(false), true)!, /needs a look/);
  assert.match(validateDrawing(emptyDrawing(true), false)!, /no look/);
});

test("drawing: shapes are checked by type, ids must be unique", () => {
  const ok: Shape[] = [
    { ...base, id: "p", type: "path", points: [[0, 0], [0.5, 0.5], [1.2, -0.1]] },
    { ...base, id: "l", type: "arrow", from: [0, 0], to: [1, 1] },
    { ...base, id: "t", type: "text", at: [0.1, 0.1], text: "Key", size: 0.05 },
    { ...base, id: "s", type: "stencil", at: [0.5, 0.5], stencil: "light", size: 0.1, rotation: 45 },
  ];
  assert.equal(validateDrawing({ v: 1, shapes: ok, look: null }, false), null);
  assert.match(validateDrawing({ v: 1, shapes: [{ ...base, type: "rect", from: [0, 0], to: [9, 9] }], look: null }, false)!, /from\/to/);
  assert.match(validateDrawing({ v: 1, shapes: [{ ...base, type: "stencil", at: [0, 0], stencil: "spaceship", size: 0.1, rotation: 0 }], look: null }, false)!, /not a known stencil/);
  assert.match(validateDrawing({ v: 1, shapes: [ok[0], ok[0]], look: null }, false)!, /used twice/);
  assert.match(validateDrawing({ v: 1, shapes: [{ ...base, color: "red", type: "line", from: [0, 0], to: [1, 1] }], look: null }, false)!, /colour/);
  assert.match(validateDrawing({ v: 2, shapes: [] }, false)!, /v must be 1/);
});

test("look: ranges and tint", () => {
  assert.equal(validateDrawing({ v: 1, shapes: [], look: { ...NEUTRAL_LOOK, exposure: -0.4, tint: "#1C2848" } }, true), null);
  assert.match(validateDrawing({ v: 1, shapes: [], look: { ...NEUTRAL_LOOK, exposure: 3.5 } }, true)!, /exposure/);
  assert.equal(validateDrawing({ v: 1, shapes: [], look: { ...NEUTRAL_LOOK, exposure: -3 } }, true), null);
  assert.match(validateDrawing({ v: 1, shapes: [], look: { ...NEUTRAL_LOOK, tint: "blue" } }, true)!, /tint/);
  assert.equal(lookFilter(NEUTRAL_LOOK, 8), "none");
  assert.equal(lookFilter({ ...NEUTRAL_LOOK, exposure: -1, bw: true }, 8), "brightness(0.2500) grayscale(1)");
  // One unit is 2 EV: the old ±1 ends render as before, the range now reaches ±6 EV.
  assert.equal(lookFilter({ ...NEUTRAL_LOOK, exposure: 1 }, 8), "brightness(4.0000)");
  assert.equal(lookFilter({ ...NEUTRAL_LOOK, exposure: -3 }, 8), "brightness(0.0156)");
});

test("presentation: mode, optional frame and label", () => {
  assert.equal(validatePresentation({ mode: "fit", frame: { width_fraction: 0.6, height_fraction: 0.45 }, label: "6K FULL · 24 mm" }), null);
  assert.equal(validatePresentation({ mode: "off", frame: null, label: null }), null);
  assert.match(validatePresentation({ mode: "crop", frame: null, label: null })!, /mode/);
  assert.match(validatePresentation({ mode: "fit", frame: { width_fraction: 0 }, label: null })!, /frame/);
});

test("geometry: bounds, move, simplify", () => {
  const rect: Shape = { ...base, type: "rect", from: [0.8, 0.2], to: [0.2, 0.6] };
  assert.deepEqual(shapeBounds(rect, 4 / 3), { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.6 });
  const moved = moveShape(rect, 0.1, -0.1);
  assert.deepEqual(moved.type === "rect" && moved.from, [0.9, 0.1]);
  const pts = simplifyPoints([[0, 0], [0.0005, 0], [0.001, 0], [0.5, 0.5], [0.5005, 0.5], [1, 1]], 0.002);
  assert.deepEqual(pts, [[0, 0], [0.5, 0.5], [1, 1]]);
});

test("markdown: inline emphasis, code and links", () => {
  assert.deepEqual(parseInline("a **b** c"), [{ kind: "text", text: "a " }, { kind: "strong", children: [{ kind: "text", text: "b" }] }, { kind: "text", text: " c" }]);
  assert.deepEqual(parseInline("_x_ and *y*"), [{ kind: "em", children: [{ kind: "text", text: "x" }] }, { kind: "text", text: " and " }, { kind: "em", children: [{ kind: "text", text: "y" }] }]);
  assert.deepEqual(parseInline("2 * 3 * 4"), [{ kind: "text", text: "2 * 3 * 4" }]);
  assert.deepEqual(parseInline("see [docs](https://example.org/a?b=1)"), [{ kind: "text", text: "see " }, { kind: "link", href: "https://example.org/a?b=1", children: [{ kind: "text", text: "docs" }] }]);
  assert.deepEqual(parseInline("[x](javascript:alert(1))"), [{ kind: "text", text: "[x](javascript:alert(1))" }]);
  assert.deepEqual(parseInline("`a*b`"), [{ kind: "code", text: "a*b" }]);
  assert.deepEqual(parseInline("\\*not\\*"), [{ kind: "text", text: "*not*" }]);
});

test("markdown: blocks", () => {
  const blocks = parseMarkdown("# Night look\n\nKey from the **window**.\nSecond line.\n\n- one\n- two\n  wrapped\n1. first\n2) second\n\n### Notes");
  assert.equal(blocks.length, 5);
  assert.deepEqual(blocks[0], { kind: "heading", level: 1, children: [{ kind: "text", text: "Night look" }] });
  assert.equal(blocks[1].kind, "paragraph");
  assert.equal(blocks[1].kind === "paragraph" && inlineText(blocks[1].children), "Key from the window. Second line.");
  assert.deepEqual(blocks[2], { kind: "list", ordered: false, items: [[{ kind: "text", text: "one" }], [{ kind: "text", text: "two wrapped" }]] });
  assert.deepEqual(blocks[3], { kind: "list", ordered: true, items: [[{ kind: "text", text: "first" }], [{ kind: "text", text: "second" }]] });
  assert.deepEqual(blocks[4], { kind: "heading", level: 3, children: [{ kind: "text", text: "Notes" }] });
  assert.equal(markdownSummary("**Night** version\n\nmore"), "Night version");
  assert.equal(markdownSummary("- a\n- b"), "a · b");
  assert.equal(markdownSummary(null), "");
});

test("mask: strokes are checked and move with their shape", () => {
  const masked: Shape = { ...base, id: "m", type: "stencil", at: [0.5, 0.5], stencil: "car", size: 0.2, rotation: 0, mask: [{ width: 0.02, points: [[0.45, 0.5], [0.55, 0.5]] }] };
  assert.equal(validateDrawing({ v: 1, shapes: [masked], look: null }, false), null);
  assert.match(validateDrawing({ v: 1, shapes: [{ ...masked, mask: [{ width: 0.02, points: [] }] }], look: null }, false)!, /mask strokes/);
  const moved = moveShape(masked, 0.1, 0);
  assert.deepEqual(moved.mask?.[0].points, [[0.55, 0.5], [0.65, 0.5]]);
});
