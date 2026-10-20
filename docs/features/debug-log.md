# Debug log (phone)

For bugs that only show on the phone. Setup → **Debug log** → "Record a detailed log", reproduce the bug, then **Share log**. It uses the Android share sheet: copy it, send it to yourself, or paste it into a chat with an AI agent. **Clear** empties it after a confirm (which offers "Share first"). The Setup hub row shows whether it records and how many entries it holds.

## What is recorded (`apps/mobile/src/log.ts`)

Only while it is on (off by default, `settings.loggingEnabled`, turned on at launch in `App.tsx`):
- every API call: method, path, status, duration; network errors (`api.ts`)
- queue events: queued, upload ok/failed with attempt count, missing files, discards (`uploads.ts`)
- rejected project/location syncs (`namedSync.ts`)
- captures (lens, rig, GPS accuracy, sequence/direct), GPS watch failures, draft discards, sequence start/photo/end, offline day saves
- `console.warn` / `console.error`, and uncaught JS errors (the global handler flushes the log before a fatal crash)

No photos and no tokens. Photo metadata ids appear.

The newest 3000 entries are kept in `Documents/openclapper-log.jsonl`, written at most every 1.5 s, so they survive a crash or restart.

## Shared text

The shared text starts with a header: export time, phone model, API host, active project, signed-in email, the pending queue (shot ids, attempts, last errors) and all settings. Then one line per entry: `ISO-time LEVEL event {json}`.

To log something new: `log("info" | "warn" | "error" | "debug", "event name", data?)`. `Error` objects are flattened automatically.
