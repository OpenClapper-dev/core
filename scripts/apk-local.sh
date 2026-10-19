#!/usr/bin/env bash
# Builds the Android app locally in a Docker container (expo prebuild + Gradle; no Expo account), then
# copies the APK to the Windows Downloads folder. WSL + Docker Desktop (WSL integration on).
#   VARIANT=dev      (make dev-build) the development build "Fielder Dev": debug-signed, no bundle
#                    inside; it loads the JavaScript, and with it the server's address, from Metro
#                    (make mobile).
#   VARIANT=release  (make apk-local) a production APK for one server: API_URL=https://… and the
#                    signing key from scripts/keystore.sh (.secrets/android/, .secrets/android.env).
# Overrides: API_URL, DOWNLOADS (target folder), ANDROID_KEYSTORE (another .jks).
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
    task=assembleDebug; out_dir=debug; name="fielder-dev-$commit.apk"
    # The development build takes its server from Metro, so the inlined one is never used.
    run+=(-e APP_VARIANT=development -e EXPO_PUBLIC_API_URL="${API_URL:-http://localhost:8787}")
    ;;
  release)
    task=assembleRelease; out_dir=release; name="fielder-$version-$commit.apk"
    if [ -f .secrets/android.env ]; then set -a; . .secrets/android.env; set +a; fi
    keystore="${ANDROID_KEYSTORE:-$PWD/.secrets/android/fielder-release.jks}"
    [ -n "${API_URL:-}" ] || { echo "Set API_URL to the server this APK talks to: API_URL=https://… make apk-local" >&2; exit 1; }
    [ -f "$keystore" ] || { echo "No signing key at $keystore: run scripts/keystore.sh once (docs/self-hosting.md#the-phone)" >&2; exit 1; }
    for v in ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
      [ -n "${!v:-}" ] || { echo "$v is not set (.secrets/android.env)" >&2; exit 1; }
    done
    run+=(-e EXPO_PUBLIC_API_URL="$API_URL" -v "$(realpath "$keystore")":/keystore.jks:ro -e ANDROID_KEYSTORE=/keystore.jks
          -e ANDROID_KEYSTORE_PASSWORD -e ANDROID_KEY_ALIAS -e ANDROID_KEY_PASSWORD)
    ;;
  *) echo "VARIANT must be dev or release" >&2; exit 1 ;;
esac
out=~/fielder-builds
mkdir -p "$out"

# Rebuilds only when the Dockerfile changed (layer cache). Gradle's cache lives in a volume.
docker build -t fielder-android -f docker/android.Dockerfile docker
docker run --rm \
  -v "$PWD":/work -v "$out":/out -v fielder-gradle:/root/.gradle "${run[@]}" \
  -w /work/apps/mobile fielder-android \
  bash -ec "# The build runs as root in place: Gradle also writes into node_modules/*/android/build.
            # Hand everything back to the host user and drop the generated android/, even on failure.
            trap 'rm -rf /work/apps/mobile/android; find /work -xdev -uid 0 -exec chown -h $(id -u):$(id -g) {} +' EXIT
            rm -rf android
            # Not pnpm exec: it checks the workspace and would reinstall the host's node_modules from here.
            node_modules/.bin/expo prebuild --platform android --no-install
            cd android && chmod +x gradlew
            ./gradlew $task --no-daemon
            apk=app/build/outputs/apk/$out_dir/app-$out_dir.apk
            # A release signed with the debug key would not update a real install.
            if [ $variant = release ] && \$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs \$apk | grep -q 'CN=Android Debug'; then echo 'release APK is debug-signed' >&2; exit 1; fi
            cp \$apk /out/$name
            chown $(id -u):$(id -g) /out/$name
            cd .."

cp "$out/$name" "$DOWNLOADS/"
echo "APK: $DOWNLOADS/$name"
