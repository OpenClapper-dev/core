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
 * app.json holds the config; this adds the version (the product's), the commit it was built from
 * (GIT_COMMIT, set by the build scripts) and release signing. APP_VARIANT=development (make dev-build,
 * make mobile) renames the development build: its own package id lets "Fielder Dev" sit next to the
 * production app instead of replacing it, with its own storage, and its green icon set
 * (assets/icons/dev, #170) tells the two apart in the drawer.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  const app: ExpoConfig = {
    ...base,
    version,
    android: { ...base.android, versionCode: versionCode(version) },
    extra: { ...base.extra, commit: process.env.GIT_COMMIT ?? "" },
  };
  if (process.env.APP_VARIANT !== "development") return withReleaseSigning(app);
  return withReleaseSigning({
    ...app,
    name: "Fielder Dev",
    scheme: "fielder-dev",
    icon: "./assets/icons/dev/app-icon-1024.png",
    android: {
      ...app.android,
      package: "app.fielder.scout.dev",
      adaptiveIcon: {
        backgroundColor: "#2E7D00",
        foregroundImage: "./assets/icons/dev/android-adaptive-foreground-1024.png",
        monochromeImage: "./assets/icons/dev/android-adaptive-monochrome-1024.png",
      },
    },
  });
};
