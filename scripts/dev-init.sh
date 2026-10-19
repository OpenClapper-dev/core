#!/usr/bin/env bash
# Bootstraps the gitignored files a fresh checkout needs before `pnpm dev`.
# Safe to re-run: existing files are left untouched.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
# The admin plane without Cloudflare Access in front: every request is admin@localhost. Dev only.
write_if_missing "apps/admin/.dev.vars" 'ADMIN_DEV_BYPASS="true"'
# No apps/mobile/.env.local: in development Expo lets .env files override the environment, so one would
# hide the tunnel URL that make mobile sets (scripts/mobile.sh refuses to start with one).

# Both Workers type-check against wrangler's generated runtime types (gitignored).
pnpm -C "$root/apps/worker" types >/dev/null
pnpm -C "$root/apps/admin" types >/dev/null
mkdir -p "$root/apps/admin/dist"

# wrangler dev refuses to boot unless assets.directory exists. In the local loop
# Vite serves the Studio on :5173 and proxies /api here, so an empty directory
# is enough; `pnpm -C apps/studio build` fills it if you want :8787 to serve the UI.
if [ -d "$root/apps/studio/dist" ]; then
  echo "  = apps/studio/dist (exists, left alone)"
else
  mkdir -p "$root/apps/studio/dist"
  echo "  + apps/studio/dist (empty; wrangler dev requires it)"
fi

echo "Applying D1 migrations to the local database:"
pnpm -C "$root/apps/worker" migrate:local

# The phone always signs in (epic #107); locally the bootstrap user, who owns the local data, gets a
# known login. Local database only.
echo "Local sign-in: dev@localhost / fielder-local-dev"
FIELDER_PASSWORD="fielder-local-dev" node "$root/scripts/user.mjs" --bootstrap --email dev@localhost --name Dev --iterations 10000 >/dev/null
