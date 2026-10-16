import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCOPES, SHORTCUTS, shortcutsMarkdown, type ScopeId, type Shortcut } from "./shortcuts.ts";

const all: readonly Shortcut[] = SHORTCUTS;
/** What a key press is matched as: chord entries live in their own "G then" namespace. */
const slots = (s: Shortcut) => s.keys.map((k) => (s.chord ? `G ${k}` : k));

test("every action is declared once per scope", () => {
  const seen = new Set<string>();
  for (const s of all) {
    const id = `${s.scope}.${s.action}`;
    assert.ok(!seen.has(id), `${id} is declared twice`);
    seen.add(id);
  }
});

test("scopes that are live together list each other", () => {
  for (const [id, sc] of Object.entries(SCOPES) as [ScopeId, (typeof SCOPES)[ScopeId]][]) {
    for (const w of sc.with) assert.ok(SCOPES[w].with.includes(id), `${id} lists ${w}, but ${w} does not list ${id}`);
  }
});

test("no key does two things where scopes are live together (within one window)", () => {
  const bound = all.filter((s) => !s.info && !s.pass);
  for (const id of Object.keys(SCOPES) as ScopeId[]) {
    // Global and the window keys are live next to every scope.
    for (const other of new Set<ScopeId>([id, "global", "wm", ...SCOPES[id].with])) {
      const used = new Map<string, string>();
      for (const s of bound.filter((x) => x.scope === id || x.scope === other)) {
        for (const k of slots(s)) {
          const prev = used.get(k);
          assert.ok(!prev || prev === `${s.scope}.${s.action}`, `"${k}" is both ${prev} and ${s.scope}.${s.action}`);
          used.set(k, `${s.scope}.${s.action}`);
        }
      }
    }
  }
});

test("docs/shortcuts.md is generated from the registry", () => {
  const doc = readFileSync(new URL("../../../docs/shortcuts.md", import.meta.url), "utf8");
  assert.equal(doc.trimEnd(), shortcutsMarkdown().trimEnd(), "regenerate: node apps/dashboard/src/shortcuts.docs.ts > docs/shortcuts.md");
});
