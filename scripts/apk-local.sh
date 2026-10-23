#!/usr/bin/env bash
# Builds the Android app locally in a Docker container (expo prebuild + Gradle; no Expo account), then
# copies the APK to the Windows Downloads folder. WSL + Docker Desktop (WSL integration on).
#   VARIANT=dev      (make dev-build) the development build "OpenClapper Dev": debug-signed, no bundle
#                    inside; it loads the JavaScript, and with it the server's address, from Metro
#                    (make mobile).
#   VARIANT=local    (make apk-local) "OpenClapper Local": a complete app with the JavaScript inside,
#                    for one server (API_URL=https://… or a LAN address), its own package id and the
#                    green icon, signed with the template's debug key. Needs no secret, so it builds
#                    from a fresh clone; it updates no other build and nothing else updates it.
# Production and staging APKs are not built here: they belong to a deployment, signed with its key
# by its Build phone app workflow (docs/self-hosting.md#the-phone).
# Overrides: API_URL, DOWNLOADS (target folder), ANDROID_ABIS (CPU architectures, comma-separated;
# default arm64-v8a, what phones run: each one more multiplies the native build and the APK).
set -euo pipefail
cd "$(dirname "$0")/.."

command -v docker > /dev/null || { echo "docker not found: Docker Desktop → Settings → Resources → WSL integration → enable this distro" >&2; exit 1; }

# The Windows user's Downloads, as a WSL path (cmd.exe complains about a UNC cwd; hence /mnt/c).
if [ -z "${DOWNLOADS:-}" ]; then
  win_home=$(cd /mnt/c && cmd.exe /c "echo %USERPROFILE%" 2>/dev/null | tr -d '\r')
  [ -n "$win_home" ] || { echo "Could not find the Windows user folder; set DOWNLOADS=/mnt/c/Users/<you>/Downloads" >&2; exit 1; }
  DOWNLOADS="$(wslpath "$win_home")/Downloads"
fi
[ -d "$DOWNLOADS" ] || { echo "No folder $DOWNLOADS; set DOWNLOADS=…" >&2; exit 1; }

variant="${VARIANT:-dev}"
commit=$(git rev-parse --short HEAD)
version=$(node -p 'require("./package.json").version')
[ -z "$(git status --porcelain)" ] || echo "Note: uncommitted changes are built, but the file is named after $commit."
run=(-e GIT_COMMIT="$commit" -e EXPO_NO_GIT_STATUS=1 -e CI=1)
case "$variant" in
  dev)
    task=assembleDebug; out_dir=debug; name="openclapper-dev-$commit.apk"
    # The development build takes its server from Metro, so the inlined one is never used.
    run+=(-e APP_VARIANT=development -e EXPO_PUBLIC_API_URL="${API_URL:-http://localhost:8787}")
    ;;
  local)
    # A release build without ANDROID_KEYSTORE signs with the debug key (app.config.ts withReleaseSigning).
    task=assembleRelease; out_dir=release; name="openclapper-local-$version-$commit.apk"
    [ -n "${API_URL:-}" ] || { echo "Set API_URL to the server this APK talks to: API_URL=https://… make apk-local" >&2; exit 1; }
    run+=(-e APP_VARIANT=local -e EXPO_PUBLIC_API_URL="$API_URL")
    ;;
  *) echo "VARIANT must be dev or local" >&2; exit 1 ;;
esac
out=~/openclapper-builds
mkdir -p "$out"

# Rebuilds only when the Dockerfile, .nvmrc or packageManager changed (layer cache). Gradle's cache
# lives in a volume.
docker build -t openclapper-android -f docker/android.Dockerfile \
  --build-arg NODE_VERSION="$(cat .nvmrc)" \
  --build-arg PACKAGE_MANAGER="$(node -p 'require("./package.json").packageManager')" \
  docker
docker run --rm \
  -v "$PWD":/work -v "$out":/out -v openclapper-gradle:/root/.gradle "${run[@]}" \
  -w /work/apps/mobile openclapper-android \
  bash -ec "# The build runs as root in place: Gradle also writes into node_modules/*/android/build.
            # Hand everything back to the host user and drop the generated android/, even on failure.
            trap 'rm -rf /work/apps/mobile/android; find /work -xdev -uid 0 -exec chown -h $(id -u):$(id -g) {} +' EXIT
            rm -rf android
            # Not pnpm exec: it checks the workspace and would reinstall the host's node_modules from here.
            node_modules/.bin/expo prebuild --platform android --no-install
            cd android && chmod +x gradlew
            ./gradlew $task --no-daemon -PreactNativeArchitectures=${ANDROID_ABIS:-arm64-v8a}
            apk=app/build/outputs/apk/$out_dir/app-$out_dir.apk
            cp \$apk /out/$name
            chown $(id -u):$(id -g) /out/$name
            cd .."

cp "$out/$name" "$DOWNLOADS/"
echo "APK: $DOWNLOADS/$name"
