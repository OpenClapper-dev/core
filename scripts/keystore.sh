#!/usr/bin/env bash
# Makes the Android release signing key of a deployment, once: <folder>/openclapper-release.jks and
# <folder>/android.env (its passwords). Android only installs an update over the app when it is signed
# with the same key: back up both files, losing them means everyone uninstalls the app (and loses what
# is queued on the phone) to install the next one. The key belongs to the deployment, not to a checkout:
# it lives in the deployment's GitHub secrets and in your backup, so the folder must be outside this
# repository (default ~/openclapper-android-key). Nothing in this repository reads it from disk.
# Uses keytool from a local JDK, else the Docker image of scripts/apk-local.sh.
#   bash scripts/keystore.sh [folder] [owner/repo]   # owner/repo: whose Build phone app workflow gets the secrets
set -euo pipefail
cd "$(dirname "$0")/.."

dir=$(realpath -m "${1:-$HOME/openclapper-android-key}")
case "$dir/" in "$PWD"/*) echo "$dir is inside this checkout; pick a folder outside it (a deployment's key is no file of the repository)." >&2; exit 1 ;; esac
mkdir -p "$dir"
jks=$dir/openclapper-release.jks
envfile=$dir/android.env
[ ! -e "$jks" ] || { echo "$jks exists already; a new key would not update installed apps. Remove it yourself if you really mean to." >&2; exit 1; }
chmod 700 "$dir"

pass=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')
alias=openclapper
dname="CN=OpenClapper, O=OpenClapper"
args=(-genkeypair -keystore /key/openclapper-release.jks -storetype PKCS12 -alias "$alias" -keyalg RSA -keysize 4096 -validity 10000 -storepass "$pass" -keypass "$pass" -dname "$dname")
if command -v keytool > /dev/null; then
  keytool "${args[@]/\/key\//$dir/}" > /dev/null
else
  command -v docker > /dev/null || { echo "Needs keytool (a JDK) or Docker" >&2; exit 1; }
  docker build -q -t openclapper-android -f docker/android.Dockerfile \
    --build-arg NODE_VERSION="$(cat .nvmrc)" \
    --build-arg PACKAGE_MANAGER="$(node -p 'require("./package.json").packageManager')" \
    docker > /dev/null
  docker run --rm -v "$dir":/key openclapper-android keytool "${args[@]}" > /dev/null
  docker run --rm -v "$dir":/key openclapper-android chown "$(id -u):$(id -g)" /key/openclapper-release.jks
fi
chmod 600 "$jks"
# PKCS12 keeps one password for the store and the key.
printf 'ANDROID_KEYSTORE_PASSWORD=%s\nANDROID_KEY_ALIAS=%s\nANDROID_KEY_PASSWORD=%s\n' "$pass" "$alias" "$pass" > "$envfile"
chmod 600 "$envfile"

repo="${2:-<owner>/<repo>}"
cat <<EOF
Made $jks and $envfile.

BACK UP BOTH FILES NOW (a password manager or an encrypted drive). Without them no update installs
over the app.

For the Build phone app workflow, set these four secrets in $repo (add --env <environment> to give them
to one GitHub environment only):
  base64 -w0 $jks | gh secret set ANDROID_KEYSTORE_BASE64 -R $repo
  gh secret set ANDROID_KEYSTORE_PASSWORD -R $repo --body "\$(sed -n 's/^ANDROID_KEYSTORE_PASSWORD=//p' $envfile)"
  gh secret set ANDROID_KEY_ALIAS -R $repo --body $alias
  gh secret set ANDROID_KEY_PASSWORD -R $repo --body "\$(sed -n 's/^ANDROID_KEY_PASSWORD=//p' $envfile)"

Then keep the folder only as long as you need it: the secrets and the backup are the key's home.
EOF
