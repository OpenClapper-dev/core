#!/usr/bin/env bash
# Makes the Android release signing key, once per deployment: .secrets/android/fielder-release.jks
# and .secrets/android.env (its passwords), both gitignored. Android only installs an update over the
# app when it is signed with the same key: keep a backup of both files, losing them means everyone
# uninstalls the app (and loses what is queued on the phone) to install the next one.
# Uses keytool from a local JDK, else the Docker image of scripts/apk-local.sh.
#   bash scripts/keystore.sh [owner/repo]   # the repository whose Build APK workflow gets the secrets
set -euo pipefail
cd "$(dirname "$0")/.."

dir=.secrets/android
jks=$dir/fielder-release.jks
envfile=.secrets/android.env
[ ! -e "$jks" ] || { echo "$jks exists already; a new key would not update installed apps. Remove it yourself if you really mean to." >&2; exit 1; }
mkdir -p "$dir"
chmod 700 .secrets "$dir"

pass=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')
alias=fielder
dname="CN=Fielder, O=Fielder"
args=(-genkeypair -keystore "$jks" -storetype PKCS12 -alias "$alias" -keyalg RSA -keysize 4096 -validity 10000 -storepass "$pass" -keypass "$pass" -dname "$dname")
if command -v keytool > /dev/null; then
  keytool "${args[@]}" > /dev/null
else
  command -v docker > /dev/null || { echo "Needs keytool (a JDK) or Docker" >&2; exit 1; }
  docker build -q -t fielder-android -f docker/android.Dockerfile docker > /dev/null
  docker run --rm -v "$PWD":/work -w /work fielder-android keytool "${args[@]}" > /dev/null
  docker run --rm -v "$PWD":/work -w /work fielder-android chown "$(id -u):$(id -g)" "$jks"
fi
chmod 600 "$jks"
# PKCS12 keeps one password for the store and the key.
printf 'ANDROID_KEYSTORE_PASSWORD=%s\nANDROID_KEY_ALIAS=%s\nANDROID_KEY_PASSWORD=%s\n' "$pass" "$alias" "$pass" > "$envfile"
chmod 600 "$envfile"

repo="${1:-<owner>/<repo>}"
cat <<EOF
Made $jks and $envfile.

BACK UP BOTH FILES NOW (a password manager or an encrypted drive). Without them no update installs
over the app.

For the Build APK workflow, set these secrets in $repo:
  base64 -w0 $jks | gh secret set ANDROID_KEYSTORE_BASE64 -R $repo
  gh secret set ANDROID_KEYSTORE_PASSWORD -R $repo --body "\$(sed -n 's/^ANDROID_KEYSTORE_PASSWORD=//p' $envfile)"
  gh secret set ANDROID_KEY_ALIAS -R $repo --body $alias
  gh secret set ANDROID_KEY_PASSWORD -R $repo --body "\$(sed -n 's/^ANDROID_KEY_PASSWORD=//p' $envfile)"
EOF
