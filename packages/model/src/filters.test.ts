import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, filterError, propertyField, type Filterable } from "./filters.ts";

const P = "0b8e5e3e-6f3a-4c1e-9a2b-1c2d3e4f5a6b";
const shot = (values: Record<string, unknown>, more: Partial<Filterable> = {}): Filterable => ({ name: "Shot 4", type: "shot", created_at: "2026-11-24T10:00:00Z", updated_at: "2026-11-24T10:00:00Z", container: null, values, ...more });

test("rules per kind, groups nest", () => {
  const f = { match: "all" as const, rules: [{ field: `p:${P}`, op: "is" as const, value: "ext" }, { match: "any" as const, rules: [{ field: "name", op: "contains" as const, value: "shot" }, { field: "type", op: "is" as const, value: "photo" }] }] };
  assert.ok(evaluate(f, shot({ [P]: "ext" })));
  assert.ok(!evaluate(f, shot({ [P]: "int" })));
  assert.ok(!evaluate(f, shot({ [P]: "ext" }, { name: "Wide" })));
  assert.ok(evaluate({ match: "all", rules: [] }, shot({})));
});

test("empty values, sets, numbers, dates", () => {
  assert.ok(evaluate({ match: "all", rules: [{ field: `p:${P}`, op: "empty" }] }, shot({})));
  assert.ok(evaluate({ match: "all", rules: [{ field: `p:${P}`, op: "is_not", value: "x" }] }, shot({})));
  assert.ok(evaluate({ match: "all", rules: [{ field: `p:${P}`, op: "in", value: ["pan", "tilt"] }] }, shot({ [P]: ["tilt", "static"] })));
  assert.ok(evaluate({ match: "all", rules: [{ field: `p:${P}`, op: "between", value: [10, 20] }] }, shot({ [P]: 15 })));
  assert.ok(evaluate({ match: "all", rules: [{ field: "created", op: "after", value: "2026-11-01" }] }, shot({})));
  assert.ok(evaluate({ match: "all", rules: [{ field: `p:${P}`, op: "is", value: "yes" }] }, shot({ [P]: true })));
  assert.ok(evaluate({ match: "all", rules: [{ field: "name", op: "is", value: "shot 4" }] }, shot({})));
});

test("filter bodies are checked", () => {
  assert.equal(filterError({ match: "all", rules: [{ field: `p:${P}`, op: "in", value: ["a"] }], types: ["shot"] }), null);
  assert.match(filterError({ match: "some", rules: [] })!, /match/);
  assert.match(filterError({ match: "all", rules: [{ field: "colour", op: "is" }] })!, /names a field/);
  assert.match(filterError({ match: "all", rules: [], extra: 1 })!, /no "extra"/);
});

test("a property becomes a field of its kind", () => {
  assert.equal(propertyField(P, "Movement", { field: "multi", options: [{ id: "pan", label: "Pan", color: 1 }], attached: [], order: 0 }).kind, "set");
  assert.deepEqual(propertyField(P, "Ready", { field: "yesno", attached: [], order: 0 }).options?.map((o) => o.id), ["yes", "no"]);
});
