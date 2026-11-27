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
# Ports: scripts/ports.mjs. Metro has to be free (the Worker on :$port may be reused, see below).
node "$root/scripts/ports.mjs" need metro
port="${PORT:-8787}"
log="$(mktemp -t openclapper-worker.XXXXXX.log)"

# A Worker already running (make dev / make worker) is reused: only the tunnel starts. A second
# Worker on another port would share the same local D1 files, and the Studio proxies to :$port.
if curl -fs -o /dev/null "http://localhost:$port/api/ping" 2>/dev/null; then reuse=1
elif (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
  echo "Port $port is taken by something that is not the Worker. Free it first." >&2
  exit 1
else reuse=0
fi
start() {
  if [ "$reuse" = 1 ]; then
    echo "Reusing the local Worker on :$port; starting a quick tunnel to it (log: $log)…"
    setsid sh -c "cd \"$root/apps/worker\" && exec pnpm exec wrangler tunnel quick-start http://localhost:$port" >"$log" 2>&1 &
  else
    echo "Starting the local Worker with a quick tunnel (log: $log)…"
    setsid sh -c "cd \"$root/apps/worker\" && exec pnpm exec wrangler dev --port $port --inspector-port 9229 --tunnel" >"$log" 2>&1 &
  fi
  # Its own process group: stopping it also stops the cloudflared that wrangler starts, which otherwise lingers.
  worker=$!
}
stop() { [ -n "$worker" ] && kill -- "-$worker" 2>/dev/null; wait "$worker" 2>/dev/null || true; worker=""; }
worker=""
trap stop EXIT
# Ctrl+C, a closed terminal or a kill: leave through EXIT, so the Worker and its tunnel stop too.
trap "exit 130" INT TERM HUP

# The quick tunnel's address. Only a tunnel's own name counts: words joined by hyphens. Its errors name
# https://api.trycloudflare.com, which once went to the phones as the server, so nothing connected.
# Quick tunnels have no uptime guarantee: when one cannot be had (a timeout, 429 too many requests),
# try again after a pause, four times in all, before giving up.
url=""
for wait_s in 0 15 45 90; do
  if [ "$wait_s" -gt 0 ]; then echo "No quick tunnel ($(grep -m1 -o 'failed.*' "$log" | cut -c1-120 || true)); trying again in $wait_s s…" >&2; sleep "$wait_s"; fi
  : >"$log"
  start
  for _ in $(seq 1 90); do
    url="$(grep -oE 'https://[a-z0-9]+(-[a-z0-9]+)+\.trycloudflare\.com' "$log" | head -1 || true)"
    [ -n "$url" ] && break
    kill -0 "$worker" 2>/dev/null || break
    sleep 1
  done
  [ -n "$url" ] && break
  stop
done
[ -n "$url" ] || { cat "$log" >&2; echo "No quick tunnel after four tries (Cloudflare's quick tunnels have no uptime guarantee); try again later." >&2; exit 1; }

# The tunnel answers a little while after its address is printed. A new name is not in DNS at once, and a
# resolver that asked too early may keep the "no such name" for minutes (seen in WSL): look the name up at
# Cloudflare itself, then ask the tunnel at that address. Only a warning: the phones use their own DNS.
host="${url#https://}"
ok=0
for _ in $(seq 1 60); do
  ip="$(curl -fs --max-time 5 -H "accept: application/dns-json" "https://cloudflare-dns.com/dns-query?name=$host&type=A" 2>/dev/null | grep -oE "\"data\":\"[0-9.]+\"" | head -1 | cut -d\" -f4 || true)"
  [ -n "$ip" ] && curl -fs --max-time 5 -o /dev/null --resolve "$host:443:$ip" "$url/api/ping" 2>/dev/null && { ok=1; break; }
  kill -0 "$worker" 2>/dev/null || { cat "$log" >&2; echo "The local Worker stopped." >&2; exit 1; }
  sleep 1
done
[ "$ok" = 1 ] || echo "Warning: the tunnel $url did not answer /api/ping within a minute; starting Metro anyway (log: $log)." >&2
echo "Local Worker: $url  (Studio: make studio → http://localhost:5173)"

# --clear: EXPO_PUBLIC_* values are inlined, and the URL is new on every run.
cd "$root/apps/mobile"
# For the dev client, "OpenClapper Dev" from Google Play or "OpenClapper Dev Local" (make dev-build): both
# have the scheme APP_VARIANT=development gives, so the QR code opens either.
EXPO_PUBLIC_API_URL="$url" EXPO_PUBLIC_STORAGE_SCOPE=local APP_VARIANT=development pnpm exec expo start --dev-client --tunnel --clear --port 8081
