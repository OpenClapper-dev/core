import type { ConfigContext, ExpoConfig } from "expo/config";
import { withAppBuildGradle } from "expo/config-plugins";
import { version } from "../../package.json";

/**
 * Android's versionCode must grow with every update; derived from the product version (root
 * package.json, docs/releasing.md) so it never needs bumping by hand: 0.1.0 → 1000, 1.2.3 → 1002003.
 */
function versionCode(v: string): number {
  const [major, minor, patch] = v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  return major * 1_000_000 + minor * 1_000 + patch;
}

/**
 * The staging app is built from main between releases, and Play takes each version code once, so it
 * counts commits instead (GIT_COMMIT_COUNT, set by the Build APK workflow from a full checkout). Without
 * the count (a local config run) it falls back to the release scheme.
 */
function stagingVersionCode(): number {
  const count = Number.parseInt(process.env.GIT_COMMIT_COUNT ?? "", 10);
  return count > 1 ? count : versionCode(version);
}

/**
 * The prebuild template signs release builds with the debug key. With ANDROID_KEYSTORE (an absolute
 * path), ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD in Gradle's
 * environment, release builds sign with that key instead (scripts/keystore.sh makes one). Read by
 * Gradle at build time, so the same generated project builds signed or not.
 */
const withReleaseSigning = (config: ExpoConfig): ExpoConfig =>
  withAppBuildGradle(config, (c) => {
    let src = c.modResults.contents;
    if (src.includes("ANDROID_KEYSTORE")) return c;
    const patch = (re: RegExp, to: string) => {
      // A template that no longer matches must fail the build, not ship a debug-signed release.
      if (!re.test(src)) throw new Error(`withReleaseSigning: android/app/build.gradle has no match for ${re}`);
      src = src.replace(re, to);
    };
    patch(
      /(buildTypes \{[\s\S]*?\brelease \{[\s\S]*?)signingConfig signingConfigs\.debug/,
      '$1signingConfig System.getenv("ANDROID_KEYSTORE") ? signingConfigs.release : signingConfigs.debug',
    );
    patch(
      /signingConfigs \{\n/,
      `signingConfigs {
        release {
            def ks = System.getenv("ANDROID_KEYSTORE")
            if (ks) {
                storeFile file(ks)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
`,
    );
    c.modResults.contents = src;
    return c;
  }) as ExpoConfig;

/**
 * The builds besides production (app.json), by APP_VARIANT. Each has its own package id, so it sits next
 * to the production app with its own storage instead of replacing it, and its own icon colour tells them
 * apart in the drawer (assets/icons, #249):
 * - development: the dev client "OpenClapper Dev" (make dev-build, make mobile), loads the JavaScript from Metro.
 * - staging: "OpenClapper Staging" for a staging instance, built by the Build APK workflow and signed
 *   with the deployment's key like production.
 * - local: "OpenClapper Local" (make apk-local), the JavaScript inside and signed with the template's
 *   debug key, so anyone can build it from a fresh clone without a secret; it updates no other build.
 */
const VARIANTS: Record<string, { name: string; slug: string; package: string; icons: string; background: string }> = {
  development: { name: "OpenClapper Dev", slug: "dev", package: "org.openclapper.dev", icons: "dev", background: "#3B7A1A" },
  staging: { name: "OpenClapper Staging", slug: "staging", package: "org.openclapper.staging", icons: "staging", background: "#B8471F" },
  local: { name: "OpenClapper Local", slug: "local", package: "org.openclapper.local", icons: "dev", background: "#3B7A1A" },
};

/**
 * app.json holds the config; this adds the version (the product's), the commit it was built from
 * (GIT_COMMIT, set by the build scripts), release signing and the variant (above).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  const app: ExpoConfig = {
    ...base,
    version,
    android: { ...base.android, versionCode: versionCode(version) },
    extra: { ...base.extra, commit: process.env.GIT_COMMIT ?? "" },
  };
  const name = process.env.APP_VARIANT;
  if (!name) return withReleaseSigning(app);
  const v = VARIANTS[name];
  // A typo must not silently build the production app.
  if (!v) throw new Error(`APP_VARIANT=${name}: expected one of ${Object.keys(VARIANTS).join(", ")}, or unset for production`);
  const icons = `./assets/icons/${v.icons}`;
  return withReleaseSigning({
    ...app,
    name: v.name,
    scheme: `openclapper-${v.slug}`,
    icon: `${icons}/app-icon-1024.png`,
    android: {
      ...app.android,
      ...(name === "staging" ? { versionCode: stagingVersionCode() } : {}),
      package: v.package,
      adaptiveIcon: {
        backgroundColor: v.background,
        foregroundImage: `${icons}/android-adaptive-foreground-1024.png`,
        monochromeImage: `${icons}/android-adaptive-monochrome-1024.png`,
      },
    },
  });
};
