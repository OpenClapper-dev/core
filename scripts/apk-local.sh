#!/usr/bin/env bash
# Build the APK locally (EAS --local, same keystore from Expo) in a Docker container, then copy
# it to the Windows Downloads folder. WSL + Docker Desktop (WSL integration on).
# Needs an Expo session: `npx eas login` once (kept in ~/.expo), or EXPO_TOKEN in the environment.
# Overrides: API_URL (the Worker the app talks to), DOWNLOADS (target folder),
# PROFILE=dev-client for the development build "Fielder Dev" (make dev-build: debug-signed, no
# Expo credentials, no bundle inside: it loads the JavaScript from Metro, see make mobile).
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
  -e EXPO_TOKEN -e EXPO_PUBLIC_API_URL="${API_URL:-${APP_URL:?set API_URL, or APP_URL in deploy.env}}" \
  -w /work/apps/mobile fielder-android \
  bash -c "node /work/node_modules/eas-cli/bin/run build --local --platform android --profile $profile --non-interactive --output /out/$name \
           && chown $(id -u):$(id -g) /out/$name"

cp "$out/$name" "$DOWNLOADS/"
echo "APK: $DOWNLOADS/$name"
