#!/usr/bin/env bash
# Bootstraps the gitignored files a fresh checkout needs before `pnpm dev`.
# Safe to re-run: existing files are left untouched.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_URL="https://fielder-api.fielder-worker.workers.dev"

write_if_missing() {
  local path="$1" content="$2"
  if [ -f "$root/$path" ]; then
    echo "  = $path (exists, left alone)"
  else
    printf '%s\n' "$content" > "$root/$path"
    echo "  + $path"
  fi
}

echo "Local dev files:"
# Lets the worker skip Cloudflare Access verification; dev only, never deployed.
write_if_missing "apps/worker/.dev.vars" 'ACCESS_DEV_BYPASS="true"'
# The admin plane without Cloudflare Access in front: every request is admin@localhost. Dev only.
write_if_missing "apps/admin/.dev.vars" 'ADMIN_DEV_BYPASS="true"'
# Expo inlines EXPO_PUBLIC_* into the bundle. Without it the login WebView
# resolves the bare path /auth/mobile against file:// and fails.
write_if_missing "apps/mobile/.env.local" "EXPO_PUBLIC_API_URL=$API_URL"

# Both Workers type-check against wrangler's generated runtime types (gitignored).
pnpm -C "$root/apps/worker" types >/dev/null
pnpm -C "$root/apps/admin" types >/dev/null
mkdir -p "$root/apps/admin/dist"

# wrangler dev refuses to boot unless assets.directory exists. In the local loop
# Vite serves the dashboard on :5173 and proxies /api here, so an empty directory
# is enough; `pnpm -C apps/dashboard build` fills it if you want :8787 to serve the UI.
if [ -d "$root/apps/dashboard/dist" ]; then
  echo "  = apps/dashboard/dist (exists, left alone)"
else
  mkdir -p "$root/apps/dashboard/dist"
  echo "  + apps/dashboard/dist (empty; wrangler dev requires it)"
fi

echo "Applying D1 migrations to the local database:"
pnpm -C "$root/apps/worker" migrate:local

# The phone always signs in (epic #107); locally the bootstrap user, who owns the local data, gets a
# known login. Local database only.
echo "Local sign-in: dev@localhost / fielder-local-dev"
FIELDER_PASSWORD="fielder-local-dev" node "$root/scripts/user.mjs" --bootstrap --email dev@localhost --name Dev --iterations 10000 >/dev/null
