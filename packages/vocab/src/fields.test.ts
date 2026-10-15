import { test } from "node:test";
import assert from "node:assert/strict";
import { droppedKeys, extraSummary, fitExtra, patchExtra, pruneExtra, selectOptions, validateFieldDef, validateValues, type FieldDef } from "./fields.ts";
import { evaluateFilter, extraFilterFields, type FilterableShot } from "./filter.ts";

const ubahn: FieldDef = {
  key: "ubahn", label: "U-Bahn", type: "group", fields: [
    { key: "line", label: "Line", type: "select", options: ["U1", "U4"] },
    { key: "station", label: "Station", type: "select", optionsBy: { field: "line", options: { U1: ["Kurfürstendamm"], U4: ["Nollendorfplatz", "Bayerischer Platz"] } } },
  ],
};
const notes: FieldDef = { key: "access", label: "Access", type: "text" };

test("a valid nested definition passes", () => {
  assert.equal(validateFieldDef(ubahn), null);
});

test("definition errors name the path", () => {
  assert.match(validateFieldDef({ key: "Bad", label: "x", type: "text" }) ?? "", /key must be lowercase/);
  assert.match(validateFieldDef({ ...ubahn, fields: [{ key: "s", label: "S", type: "select", optionsBy: { field: "nope", options: {} } }] }) ?? "", /ubahn\.s: optionsBy\.field "nope"/);
  assert.match(validateFieldDef({ key: "a", label: "A", type: "select" }) ?? "", /exactly one of options or optionsBy/);
  assert.match(validateFieldDef({ key: "a", label: "A", type: "text", options: ["x"] }) ?? "", /only apply to selects/);
});

test("dependent select options follow the sibling value", () => {
  const station = ubahn.fields![1];
  assert.deepEqual(selectOptions(station, { line: "U4" }), ["Nollendorfplatz", "Bayerischer Platz"]);
  assert.deepEqual(selectOptions(station, {}), []);
});

test("values are validated against the definitions", () => {
  assert.equal(validateValues([ubahn, notes], { ubahn: { line: "U4", station: "Nollendorfplatz" }, access: "key at the gate" }), null);
  assert.match(validateValues([ubahn], { ubahn: { line: "U1", station: "Nollendorfplatz" } }) ?? "", /extra\.ubahn\.station/);
  assert.match(validateValues([ubahn], { other: 1 }) ?? "", /no such field/);
});

test("prune drops empty values and groups; summary uses labels", () => {
  const pruned = pruneExtra({ ubahn: { line: "U4", station: "" }, access: "", empty: {} });
  assert.deepEqual(pruned, { ubahn: { line: "U4" } });
  assert.equal(extraSummary([ubahn], pruned), "U-Bahn › Line: U4");
});

test("filters reach nested extra values", () => {
  const extra = extraFilterFields([ubahn, notes]);
  assert.deepEqual(extra.map((f) => f.id), ["extra.ubahn.line", "extra.ubahn.station", "extra.access"]);
  const shot = { extra: { ubahn: { line: "U4", station: "Nollendorfplatz" } } } as unknown as FilterableShot;
  assert.equal(evaluateFilter({ match: "all", rules: [{ field: "extra.ubahn.station", op: "is", value: "Nollendorfplatz" }] }, shot, extra), true);
  assert.equal(evaluateFilter({ match: "all", rules: [{ field: "extra.ubahn.line", op: "is", value: "U1" }] }, shot, extra), false);
});

test("a bulk patch replaces only its keys and drops invalidated dependents", () => {
  const line: FieldDef = { key: "line", label: "Line", type: "select", options: ["U1", "U4"] };
  const stop: FieldDef = { key: "stop", label: "Stop", type: "select", optionsBy: { field: "line", options: { U1: ["Kurfürstendamm"], U4: ["Nollendorfplatz"] } } };
  const defs = [line, stop, notes];
  const shot = { line: "U4", stop: "Nollendorfplatz", access: "gate" };
  assert.deepEqual(patchExtra(defs, shot, { access: "side door" }), { line: "U4", stop: "Nollendorfplatz", access: "side door" });
  assert.deepEqual(patchExtra(defs, shot, { access: null }), { line: "U4", stop: "Nollendorfplatz" });
  assert.deepEqual(patchExtra(defs, shot, { line: "U1" }), { line: "U1", access: "gate" });
  assert.deepEqual(patchExtra(defs, shot, { line: "U1", stop: "Kurfürstendamm" }), { line: "U1", stop: "Kurfürstendamm", access: "gate" });
});

test("a bulk patch merges groups child by child", () => {
  const access: FieldDef = { key: "access", label: "Access", type: "group", fields: [{ key: "parking", label: "Parking", type: "text" }, { key: "power", label: "Power", type: "boolean" }] };
  const shot = { access: { parking: "street", power: true }, ubahn: { line: "U4", station: "Nollendorfplatz" } };
  assert.deepEqual(patchExtra([access, ubahn], shot, { access: { parking: "yard" } }), { access: { parking: "yard", power: true }, ubahn: shot.ubahn });
  assert.deepEqual(patchExtra([access, ubahn], shot, { access: { parking: "" } }), { access: { power: true }, ubahn: shot.ubahn });
  assert.deepEqual(patchExtra([access, ubahn], shot, { access: null }), { ubahn: shot.ubahn });
  assert.deepEqual(patchExtra([access, ubahn], shot, { ubahn: { line: "U1" } }), { access: shot.access, ubahn: { line: "U1" } });
});

test("validation can be limited to the edited keys", () => {
  const stale = { gone: "field removed from the project", access: "ok" };
  assert.match(validateValues([notes], stale) ?? "", /no such field/);
  assert.equal(validateValues([notes], stale, "extra", ["access"]), null);
});

test("moving to another project keeps only the values its fields accept", () => {
  const shot = { ubahn: { line: "U4", station: "Nollendorfplatz" }, access: "gate code 1234", parking: "yard" };
  const target: FieldDef[] = [ubahn, { key: "access", label: "Access", type: "number" }];
  assert.deepEqual(fitExtra(target, shot), { ubahn: shot.ubahn });
  assert.deepEqual(droppedKeys(target, shot), ["access", "parking"]);
  assert.deepEqual(droppedKeys([ubahn, notes], shot), ["parking"]);
});
