// The service-account assertion and the two Play answers the upload treats specially (scripts/play-upload.mjs).
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { alreadyUsed, assertion, draftOnly } from "./play-upload.mjs";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = { client_email: "uploader@project.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: "https://oauth2.googleapis.com/token" };
const part = (s) => JSON.parse(Buffer.from(s, "base64url").toString());

test("the assertion is an RS256 JWT for the androidpublisher scope, valid for an hour", () => {
  const jwt = assertion(account, 1_800_000_000);
  const [head, claims, sig] = jwt.split(".");
  assert.ok(!/[+/=]/.test(jwt), "base64url, no padding");
  assert.deepEqual(part(head), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(part(claims), { iss: account.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: account.token_uri, iat: 1_800_000_000, exp: 1_800_003_600 });
  assert.ok(createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(publicKey, Buffer.from(sig, "base64url")));
});

test("a key without the service account's fields is refused with a hint", () => {
  assert.throws(() => assertion({ type: "authorized_user" }), /service account's JSON key/);
});

test("Play's answers: a version code already used, and a draft-only app", () => {
  assert.ok(alreadyUsed("Version code 10000 has already been used."));
  assert.ok(!alreadyUsed("The caller does not have permission"));
  assert.ok(draftOnly("Only releases with status draft may be created on draft app."));
  assert.ok(!draftOnly("Version code 10000 has already been used."));
});
