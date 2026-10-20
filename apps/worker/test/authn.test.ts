import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, NO_PASSWORD, passwordProblem, targetIterations, verifyPassword } from "@openclapper/service-kit";
import { requestToken, sessionCookie, sha256Hex } from "../src/authn/sessions.ts";

const FAST = 10_000;

test("a password verifies against its own hash only", async () => {
  const stored = await hashPassword("correct horse battery", FAST);
  assert.match(stored, /^pbkdf2-sha256\$10000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.deepEqual(await verifyPassword("correct horse battery", stored, FAST), { ok: true, needsRehash: false });
  assert.equal((await verifyPassword("correct horse batterY", stored, FAST)).ok, false);
});

test("two hashes of one password differ (salted)", async () => {
  assert.notEqual(await hashPassword("same password!", FAST), await hashPassword("same password!", FAST));
});

test("a hash at another iteration count asks to be rehashed, a wrong password never does", async () => {
  const stored = await hashPassword("correct horse battery", FAST);
  assert.deepEqual(await verifyPassword("correct horse battery", stored, 20_000), { ok: true, needsRehash: true });
  assert.deepEqual(await verifyPassword("wrong password!!", stored, 20_000), { ok: false, needsRehash: false });
});

test("the disabled and malformed hashes never verify", async () => {
  for (const stored of [NO_PASSWORD, "", "pbkdf2-sha256$abc$x$y", "pbkdf2-sha256$999999999$AAAA$AAAA", "md5$1$a$b"]) {
    assert.equal((await verifyPassword("anything at all", stored, FAST)).ok, false, stored);
  }
});

test("NFKC: a composed and a decomposed é are the same password", async () => {
  const stored = await hashPassword("café au lait!", FAST);
  assert.equal((await verifyPassword("café au lait!", stored, FAST)).ok, true);
});

test("iteration target: default 100 000, clamped to what Workers allow", () => {
  assert.equal(targetIterations({}), 100_000);
  assert.equal(targetIterations({ PBKDF2_ITERATIONS: "50000" }), 50_000);
  assert.equal(targetIterations({ PBKDF2_ITERATIONS: "900000" }), 100_000);
  assert.equal(targetIterations({ PBKDF2_ITERATIONS: "5" }), 10_000);
  assert.equal(targetIterations({ PBKDF2_ITERATIONS: "lots" }), 100_000);
});

test("password rules", () => {
  assert.equal(passwordProblem("short"), "password must be at least 10 characters");
  assert.equal(passwordProblem("x".repeat(201)), "password must be at most 200 characters");
  assert.equal(passwordProblem("long enough pw"), null);
});

test("the token comes from the bearer header first, then the cookie", () => {
  const both = new Request("https://x/", { headers: { Authorization: "Bearer abc", Cookie: "a=1; openclapper_session=def; b=2" } });
  assert.equal(requestToken(both), "abc");
  assert.equal(requestToken(new Request("https://x/", { headers: { Cookie: "a=1; openclapper_session=def" } })), "def");
  assert.equal(requestToken(new Request("https://x/", { headers: { Authorization: "Basic xyz" } })), null);
  assert.equal(requestToken(new Request("https://x/")), null);
});

test("the session cookie is out of reach of scripts and cross-site requests", () => {
  const c = sessionCookie("tok");
  for (const part of ["openclapper_session=tok", "HttpOnly", "Secure", "SameSite=Lax", "Path=/"]) assert.ok(c.includes(part), part);
});

test("tokens are stored as their SHA-256", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});
