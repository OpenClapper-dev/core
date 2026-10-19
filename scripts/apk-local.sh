#!/usr/bin/env bash
# Build an APK locally (EAS --local) in a Docker container, then copy it to the Windows Downloads
# folder. WSL + Docker Desktop (WSL integration on). `make dev-build` runs it with PROFILE=dev-client:
# the development build "Fielder Dev" (debug-signed, no bundle inside: it loads the JavaScript, and
# with it the server's address, from Metro, see make mobile).
# A production APK (PROFILE=apk, the keystore from Expo) needs API_URL=<your server>; deployments
# build it with the Build APK workflow instead (docs/self-hosting.md).
# Needs an Expo session: `npx eas login` once (kept in ~/.expo), or EXPO_TOKEN in the environment.
# Overrides: API_URL, DOWNLOADS (target folder), PROFILE.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker > /dev/null || { echo "docker not found: Docker Desktop → Settings → Resources → WSL integration → enable this distro" >&2; exit 1; }
if [ -z "${EXPO_TOKEN:-}" ] && ! npx --no-install eas whoami > /dev/null 2>&1; then
  echo "Not logged in to Expo: run 'npx eas login' once (or set EXPO_TOKEN)" >&2; exit 1
fi

# The Windows user's Downloads, as a WSL path (cmd.exe complains about a UNC cwd; hence /mnt/c).
if [ -z "${DOWNLOADS:-}" ]; then
  win_home=$(cd /mnt/c && cmd.exe /c "echo %USERPROFILE%" 2>/dev/null | tr -d '\r')
  [ -n "$win_home" ] || { echo "Could not find the Windows user folder; set DOWNLOADS=/mnt/c/Users/<you>/Downloads" >&2; exit 1; }
  DOWNLOADS="$(wslpath "$win_home")/Downloads"
fi
[ -d "$DOWNLOADS" ] || { echo "No folder $DOWNLOADS; set DOWNLOADS=…" >&2; exit 1; }

profile="${PROFILE:-apk}"
# The development build takes its server from Metro, so the inlined one is never used.
[ "$profile" = dev-client ] && api_url="${API_URL:-http://localhost:8787}" || api_url="${API_URL:?set API_URL to your server (or use the Build APK workflow)}"
commit=$(git rev-parse --short HEAD)
name="fielder-$commit.apk"
[ "$profile" = apk ] || name="fielder-$profile-$commit.apk"
[ -z "$(git status --porcelain)" ] || echo "Note: uncommitted changes are built, but the file is named after $commit."
out=~/fielder-builds
mkdir -p "$out" ~/.expo

# Rebuilds only when the Dockerfile changed (layer cache). Gradle's cache lives in a volume.
docker build -t fielder-android -f docker/android.Dockerfile docker
docker run --rm \
  -v "$PWD":/work -v ~/.expo:/root/.expo -v "$out":/out -v fielder-gradle:/root/.gradle \
  -e EXPO_TOKEN -e EXPO_PUBLIC_API_URL="$api_url" \
  -w /work/apps/mobile fielder-android \
  bash -c "node /work/node_modules/eas-cli/bin/run build --local --platform android --profile $profile --non-interactive --output /out/$name \
           && chown $(id -u):$(id -g) /out/$name"

cp "$out/$name" "$DOWNLOADS/"
echo "APK: $DOWNLOADS/$name"
