#!/usr/bin/env node
// Uploads an Android App Bundle to a Google Play track, with Google's own API (androidpublisher v3)
// and nothing else: no Expo account, no third-party action, no dependency. Run by the Build phone app
// workflow with `track` set; like every script here it reads its secret from the environment only.
//
//   node scripts/play-upload.mjs --bundle app.aab --package org.openclapper --track internal [--notes "…"] [--status completed|draft]
//
//   PLAY_SERVICE_ACCOUNT_JSON   the service account's JSON key (its content), invited in the Play Console
//                               with "Release to testing tracks" on the app (docs/self-hosting.md, Play Store)
//
// A version code that Play already has is not an error: the run says so and ends green, so a release
// built again uploads nothing. An app that was never published only takes draft releases: the script
// then retries as a draft, which the Console rolls out by hand.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications";
const UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications";

const b64url = (data) => Buffer.from(data).toString("base64url");

/** The service account's signed assertion for Google's token endpoint (RFC 7523), valid for an hour. */
export function assertion(account, now = Math.floor(Date.now() / 1000)) {
  if (!account?.client_email || !account?.private_key) throw new Error("PLAY_SERVICE_ACCOUNT_JSON has no client_email or private_key: use the service account's JSON key");
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: account.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(account.private_key).toString("base64url");
  return `${head}.${claims}.${signature}`;
}

/** Play's answer when the bundle's version code is already taken in this app. */
export const alreadyUsed = (message) => /version code \d+ has already been used|already been used/i.test(message);
/** Play's answer when an app that was never published gets a release that is not a draft. */
export const draftOnly = (message) => /only releases with status draft/i.test(message);

async function call(token, method, url, body, headers = {}) {
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, ...(body && !(body instanceof Uint8Array) ? { "content-type": "application/json" } : {}), ...headers }, body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) { const e = new Error(json.error?.message ?? `HTTP ${res.status}`); e.status = res.status; throw e; }
  return json;
}

async function main() {
  const { values: o } = parseArgs({ options: { bundle: { type: "string" }, package: { type: "string" }, track: { type: "string", default: "internal" }, notes: { type: "string" }, status: { type: "string", default: "completed" } } });
  if (!o.bundle || !o.package) { console.error("usage: node scripts/play-upload.mjs --bundle app.aab --package <id> [--track internal] [--notes …] [--status completed|draft]"); process.exit(1); }
  const raw = process.env.PLAY_SERVICE_ACCOUNT_JSON;
  if (!raw) { console.error("play-upload: PLAY_SERVICE_ACCOUNT_JSON is not set (docs/self-hosting.md, Play Store)"); process.exit(1); }
  const account = JSON.parse(raw);

  const tokenRes = await fetch(account.token_uri ?? "https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertion(account) }) });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(`token: ${tokenJson.error_description ?? tokenJson.error ?? tokenRes.status}`);
  const token = tokenJson.access_token;

  const app = `${API}/${encodeURIComponent(o.package)}`;
  const edit = await call(token, "POST", `${app}/edits`, {});
  const inEdit = `${app}/edits/${edit.id}`;
  try {
    let versionCode;
    try {
      // The bundle as the request body; Play processes it before answering, which may take a minute.
      ({ versionCode } = await call(token, "POST", `${UPLOAD}/${encodeURIComponent(o.package)}/edits/${edit.id}/bundles?uploadType=media`, new Uint8Array(readFileSync(o.bundle)), { "content-type": "application/octet-stream" }));
    } catch (e) {
      if (!alreadyUsed(e.message)) throw e;
      console.log(`play-upload: ${o.package} already has this version code on Play; nothing uploaded (${e.message})`);
      await call(token, "DELETE", inEdit).catch(() => {});
      return;
    }
    const release = (status) => ({ track: o.track, releases: [{ versionCodes: [String(versionCode)], status, ...(o.notes ? { releaseNotes: [{ language: "en-US", text: o.notes.slice(0, 500) }] } : {}) }] });
    let status = o.status;
    try {
      await call(token, "PUT", `${inEdit}/tracks/${o.track}`, release(status));
    } catch (e) {
      if (status === "draft" || !draftOnly(e.message)) throw e;
      status = "draft";
      console.log("play-upload: the app was never published, so Play takes draft releases only; roll it out in the Console (Testing → the track)");
      await call(token, "PUT", `${inEdit}/tracks/${o.track}`, release(status));
    }
    await call(token, "POST", `${inEdit}:commit`);
    console.log(`play-upload: ${o.package} version code ${versionCode} on the ${o.track} track (${status})`);
  } catch (e) {
    await call(token, "DELETE", inEdit).catch(() => {});
    throw e;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`play-upload: ${e.message}`); process.exit(1); });
