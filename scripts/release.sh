#!/usr/bin/env bash
# Cuts a release of the whole product (docs/releasing.md): sets the version in the root package.json,
# commits, tags vX.Y.Z on main, pushes both and publishes a GitHub release with notes generated from
# the merged pull requests (a pre-release while the major version is 0).
#   scripts/release.sh 0.2.0
set -euo pipefail
cd "$(dirname "$0")/.."

next="${1:?usage: scripts/release.sh <X.Y.Z>}"
[[ "$next" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo "Not a version: $next (X.Y.Z)" >&2; exit 1; }
current=$(node -p 'require("./package.json").version')

[ "$(git branch --show-current)" = main ] || { echo "Release from main" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "The working tree is not clean" >&2; exit 1; }
git fetch -q origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main is not the same as origin/main: pull or push first" >&2; exit 1; }
! git rev-parse -q --verify "refs/tags/v$next" > /dev/null || { echo "v$next exists already" >&2; exit 1; }
# Greater than the current version (the Android versionCode is derived from it), or the current one
# itself while it has no tag yet (the first release of a version already in package.json).
first=false
if [ "$next" = "$current" ]; then first=true
else node -e 'const [a, b] = process.argv.slice(1).map((v) => v.split(".").map(Number)); const d = a.map((x, i) => x - b[i]).find((x) => x !== 0); process.exit(d > 0 ? 0 : 1)' "$next" "$current" \
  || { echo "$next is not greater than $current" >&2; exit 1; }
fi
gh auth status > /dev/null 2>&1 || { echo "gh is not logged in" >&2; exit 1; }

if ! $first; then
  node -e 'const fs = require("fs"); const p = JSON.parse(fs.readFileSync("package.json", "utf8")); p.version = process.argv[1]; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")' "$next"
  git commit -q -m "Release v$next" package.json
fi
git tag -a "v$next" -m "v$next"
git push -q origin main "v$next"

prerelease=()
[ "${next%%.*}" != 0 ] || prerelease=(--prerelease)
gh release create "v$next" --title "v$next" --generate-notes --verify-tag "${prerelease[@]}"

cat <<EOF
Released v$next ($current before).
A deployment follows with: scripts/bump.sh v$next, commit and push, run Deploy, then Build APK.
EOF
