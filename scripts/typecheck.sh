#!/usr/bin/env bash
# `pnpm typecheck`: tsc in every package with a tsconfig. The Workers type-check against wrangler's
# generated runtime types (gitignored); they are generated here when missing (`make init` also does it).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

for w in apps/worker apps/admin; do
  [ -f "$w/worker-configuration.d.ts" ] || pnpm -C "$w" types >/dev/null
done

for p in packages/vocab packages/fov-math packages/service-kit packages/ui apps/worker apps/worker/test/routes apps/admin apps/admin/ui apps/studio apps/mobile; do
  echo "tsc $p"
  (cd "$p" && npx tsc -p .)
done
