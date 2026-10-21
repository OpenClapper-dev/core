#!/usr/bin/env bash
# `pnpm build`: build dry runs, nothing is deployed. The Vite builds come first: both Workers serve them
# as assets (assets.directory), so their dry runs need the outputs to exist. The Worker dry runs use the
# tracked local wrangler.jsonc (no account, no token). The Expo export proves Metro can bundle the app.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

(cd apps/studio && npx vite build)
(cd apps/admin && npx vite build)
node scripts/csp-hash.mjs --check   # the CSP in each public/_headers still allows the inline script
(cd apps/worker && npx wrangler deploy --dry-run --outdir "$out/worker")
(cd apps/admin && npx wrangler deploy --dry-run --outdir "$out/admin")
(cd apps/mobile && npx expo export --platform android --output-dir /tmp/openclapper-export)
