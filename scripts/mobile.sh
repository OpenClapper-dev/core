#!/usr/bin/env bash
# make mobile: the phone against the LOCAL Worker. wrangler dev behind a Cloudflare quick tunnel
# (WSL2 in NAT mode is not reachable from the phone), then Metro with the tunnel URL baked in.
# The URL changes every run; the phone keeps its local data under the "local" storage scope,
# apart from production's. Ctrl-C stops Metro and the Worker.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${PORT:-8787}"
log="$(mktemp -t fielder-worker.XXXXXX.log)"

if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
  echo "Port $port is taken (make dev / make worker?). Stop it: this target starts its own Worker with the tunnel." >&2
  exit 1
fi

echo "Starting the local Worker with a quick tunnel (log: $log)…"
(cd "$root/apps/worker" && exec pnpm exec wrangler dev --port "$port" --tunnel) >"$log" 2>&1 &
worker=$!
trap 'kill "$worker" 2>/dev/null; wait "$worker" 2>/dev/null || true' EXIT

url=""
for _ in $(seq 1 90); do
  url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$log" | head -1 || true)"
  [ -n "$url" ] && break
  kill -0 "$worker" 2>/dev/null || { cat "$log" >&2; echo "The Worker exited." >&2; exit 1; }
  sleep 1
done
[ -n "$url" ] || { cat "$log" >&2; echo "No tunnel URL after 90 s." >&2; exit 1; }

# The tunnel answers a few seconds after the URL is printed.
for _ in $(seq 1 30); do curl -fs -o /dev/null "$url/health" 2>/dev/null && break; sleep 1; done
echo "Local Worker: $url  (dashboard: make dashboard → http://localhost:5173)"

# --clear: EXPO_PUBLIC_* values are inlined, and the URL is new on every run.
cd "$root/apps/mobile"
EXPO_PUBLIC_API_URL="$url" EXPO_PUBLIC_STORAGE_SCOPE=local pnpm exec expo start --go --tunnel --clear
