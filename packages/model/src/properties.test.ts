import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedOptions, definitionError, fitValue, fold, matchesSearch, optionId, patternProblems, renderName, TEMPLATE, valueError, valueText, type PropertyDef } from "./properties.ts";

const PARENT = "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6b";
const line: PropertyDef = { field: "choice", options: [{ id: "u1", label: "U1", color: 1 }, { id: "u4", label: "U4", color: 2 }], attached: [{ type: "location" }], order: 0 };
const station: PropertyDef = {
  field: "choice", options: [{ id: "kudamm", label: "Kurfürstendamm", color: 0 }, { id: "nolle", label: "Nollendorfplatz", color: 0 }], attached: [{ type: "location" }], order: 1,
  dependsOn: { property: PARENT, map: { u1: ["kudamm"], u4: ["nolle"] } },
};

test("the template is valid", () => {
  for (const t of TEMPLATE) assert.equal(definitionError({ ...t.def, order: 0 } as unknown as Record<string, unknown>), null, t.name);
});

test("definitions: unknown keys, options only on choices, dependsOn maps to own options", () => {
  assert.match(definitionError({ field: "text", attached: [], order: 0, extra: 1 })!, /no "extra"/);
  assert.match(definitionError({ field: "text", options: [], attached: [], order: 0 })!, /only a choice/);
  assert.match(definitionError({ ...station, dependsOn: { property: PARENT, map: { u1: ["nope"] } } } as unknown as Record<string, unknown>)!, /maps the parent/);
  assert.match(definitionError({ field: "choice", options: [{ id: "a", label: "A", color: 9 }], attached: [], order: 0 })!, /colour/);
  assert.match(definitionError({ field: "text", attached: [{ type: "shot" }, { type: "shot" }], order: 0 })!, /twice/);
  assert.equal(definitionError({ field: "reference", targets: ["set"], many: true, attached: [{ type: "shot" }], order: 0 }), null);
});

test("values per field type", () => {
  const d = (field: PropertyDef["field"], more: Partial<PropertyDef> = {}): PropertyDef => ({ field, attached: [], order: 0, ...more });
  assert.equal(valueError(d("text"), "Scene 4"), null);
  assert.ok(valueError(d("text"), "two\nlines"));
  assert.equal(valueError(d("long"), "two\nlines"), null);
  assert.equal(valueError(d("number"), 3.5), null);
  assert.ok(valueError(d("number"), "3"));
  assert.equal(valueError(d("yesno"), false), null);
  assert.equal(valueError(d("date"), "2026-11-24"), null);
  assert.ok(valueError(d("date"), "24.11.2026"));
  assert.equal(valueError(d("position"), { lat: 52.5, lng: 13.4 }), null);
  assert.ok(valueError(d("position"), { lat: 95, lng: 0 }));
  assert.equal(valueError(d("reference"), [PARENT]), null);
  assert.ok(valueError(d("reference"), [PARENT, "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6c"]), "one file unless many");
  assert.equal(valueError(d("reference", { many: true }), [PARENT, "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6c"]), null);
  assert.equal(valueError(line, "u4"), null);
  assert.ok(valueError(line, "u9"));
  assert.equal(valueError({ ...line, field: "multi" }, ["u1", "u4"]), null);
  assert.ok(valueError({ ...line, field: "multi" }, ["u1", "u1"]));
});

test("a dependent choice offers what its parent's value allows", () => {
  assert.deepEqual(allowedOptions(station, "u4").map((o) => o.id), ["nolle"]);
  assert.deepEqual(allowedOptions(station, null), []);
  assert.equal(valueError(station, "nolle", "u4"), null);
  assert.ok(valueError(station, "nolle", "u1"));
  assert.equal(fitValue(station, "nolle", "u1"), null, "a parent change clears what no longer fits");
});

test("fitting a value to a changed definition keeps what still fits", () => {
  const multi: PropertyDef = { ...line, field: "multi" };
  assert.deepEqual(fitValue({ ...multi, options: [line.options![0]] }, ["u1", "u4"]), ["u1"]);
  assert.equal(fitValue({ field: "number", attached: [], order: 0 }, "x"), null);
  assert.deepEqual(fitValue({ field: "reference", attached: [], order: 0 }, [PARENT, PARENT.replace(/b$/, "c")]), [PARENT]);
});

test("value text", () => {
  assert.equal(valueText(line, "u4"), "U4");
  assert.equal(valueText({ field: "yesno", attached: [], order: 0 }, true), "Yes");
  assert.equal(valueText({ field: "number", unit: "mm", attached: [], order: 0 }, 35), "35 mm");
});

test("option ids from labels", () => {
  assert.equal(optionId("Push in"), "push-in");
  assert.equal(optionId("Über"), "uber");
  assert.equal(optionId("Day", ["day"]), "day-2");
});

test("naming patterns: problems and names", () => {
  assert.deepEqual(patternProblems("{type} {counter}", "shot"), []);
  assert.deepEqual(patternProblems("{ddd}", "shot"), ["{ddd} is not a token."]);
  assert.deepEqual(patternProblems("{device} {counter}", "shot"), ["{device} only works on photos."]);
  assert.deepEqual(patternProblems("{type} {counter", "shot"), ["A brace without its partner."]);
  const at = new Date(2026, 10, 24, 9, 5);
  assert.equal(renderName("{type} {counter}", 3, { type: "shot", label: "Shot", counter: 12, at }), "Shot 012");
  assert.equal(renderName("{date}_{counter}", 4, { type: "photo", label: "Photo", counter: 7, at }), "2026-11-24_0007");
  assert.equal(renderName("{device} · {counter}", 2, { type: "photo", label: "Photo", counter: 3, at, device: null }), "03");
  assert.equal(renderName("{focal} {time}", 1, { type: "photo", label: "Photo", counter: 1, at, focal: 24 }), "24mm 09-05");
});

test("search folds case and accents, every word must match", () => {
  assert.equal(fold("Über"), "uber");
  assert.equal(fold("Straße"), "strasse");
  assert.ok(matchesSearch("uber", ["Über den Dächern"]));
  assert.ok(matchesSearch("über dach", ["Über den Dächern"]));
  assert.ok(matchesSearch("ext night", ["Shot 4", "EXT", "Night"]));
  assert.ok(!matchesSearch("ext day", ["Shot 4", "EXT", "Night"]));
});
