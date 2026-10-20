#!/usr/bin/env bash
# make mobile: the phone against the LOCAL Worker. wrangler dev behind a Cloudflare quick tunnel
# (WSL2 in NAT mode is not reachable from the phone), then Metro with the tunnel URL baked in.
# The URL changes every run; the phone keeps its local data under the "local" storage scope,
# apart from production's. Ctrl-C stops Metro and what this script started (Worker or tunnel).
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# In development Expo serves EXPO_PUBLIC_* from the .env files ahead of the environment
# (expo/virtual/env), so a URL there would beat the tunnel and the phone would talk to that server.
if envs=$(grep -ls "^[[:space:]]*EXPO_PUBLIC_" "$root"/apps/mobile/.env* 2>/dev/null); then
  echo "These files set EXPO_PUBLIC_* and would override the local server in the app: $envs" >&2
  echo "Remove the EXPO_PUBLIC_* lines (or the files); make mobile sets them itself." >&2
  exit 1
fi
port="${PORT:-8787}"
log="$(mktemp -t fielder-worker.XXXXXX.log)"

# A Worker already running (make dev / make worker) is reused: only the tunnel starts. A second
# Worker on another port would share the same local D1 files, and the Studio proxies to :$port.
if curl -fs -o /dev/null "http://localhost:$port/api/ping" 2>/dev/null; then
  echo "Reusing the local Worker on :$port; starting a quick tunnel to it (log: $log)…"
  (cd "$root/apps/worker" && exec pnpm exec wrangler tunnel quick-start "http://localhost:$port") >"$log" 2>&1 &
elif (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
  echo "Port $port is taken by something that is not the Worker. Free it first." >&2
  exit 1
else
  echo "Starting the local Worker with a quick tunnel (log: $log)…"
  (cd "$root/apps/worker" && exec pnpm exec wrangler dev --port "$port" --tunnel) >"$log" 2>&1 &
fi
worker=$!
trap 'kill "$worker" 2>/dev/null; wait "$worker" 2>/dev/null || true' EXIT

url=""
for _ in $(seq 1 90); do
  url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$log" | head -1 || true)"
  [ -n "$url" ] && break
  kill -0 "$worker" 2>/dev/null || { cat "$log" >&2; echo "The Worker or tunnel exited." >&2; exit 1; }
  sleep 1
done
[ -n "$url" ] || { cat "$log" >&2; echo "No tunnel URL after 90 s." >&2; exit 1; }

# The tunnel answers a few seconds after the URL is printed.
for _ in $(seq 1 30); do curl -fs -o /dev/null "$url/api/ping" 2>/dev/null && break; sleep 1; done
echo "Local Worker: $url  (Studio: make studio → http://localhost:5173)"

# --clear: EXPO_PUBLIC_* values are inlined, and the URL is new on every run.
cd "$root/apps/mobile"
# For the development build "OpenClapper Dev" (make dev-build); APP_VARIANT picks its name and package id.
EXPO_PUBLIC_API_URL="$url" EXPO_PUBLIC_STORAGE_SCOPE=local APP_VARIANT=development pnpm exec expo start --dev-client --tunnel --clear
