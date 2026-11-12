import type { ConfigContext, ExpoConfig } from "expo/config";
import { withAndroidManifest, withAppBuildGradle, withGradleProperties, withMainApplication } from "expo/config-plugins";
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
 * The staging app and the dev client on Google Play are built from any ref between releases, and Android
 * only installs a higher version code, so they use the build time instead (BUILD_TIME_VERSION_CODE,
 * minutes since 2020, set by the Build phone app workflow): a build of an older ref still installs as an
 * update. Without it (a local config run) it falls back to the release scheme.
 */
function buildTimeVersionCode(): number {
  const code = Number.parseInt(process.env.BUILD_TIME_VERSION_CODE ?? "", 10);
  return code > 0 ? code : versionCode(version);
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
 * The Bluetooth plugin (react-native-ble-plx, lights #208) with `neverForLocation` declares the location
 * permissions again as `uses-permission-sdk-23` capped at Android 11 (maxSdkVersion 30). The app needs
 * them on every version for GPS (app.json, expo-location), and Google Play rejects a permission declared
 * twice with different maxSdkVersions. So the capped copies go; Bluetooth scanning keeps its
 * `neverForLocation` flag.
 */
const LOCATION = new Set(["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"]);
const withUncappedLocation = (config: ExpoConfig): ExpoConfig =>
  withAndroidManifest(config, (c) => {
    const m = c.modResults.manifest as { "uses-permission-sdk-23"?: { $: Record<string, string> }[] };
    const sdk23 = m["uses-permission-sdk-23"];
    if (sdk23) m["uses-permission-sdk-23"] = sdk23.filter((p) => !(LOCATION.has(p.$["android:name"]) && p.$["android:maxSdkVersion"]));
    return c;
  }) as ExpoConfig;

/**
 * expo-dev-launcher and expo-dev-menu compile themselves out of release builds unless these Gradle
 * properties say otherwise (their android/build.gradle). The dev client on Google Play must be a release
 * build (Play rejects debuggable bundles), so it keeps them in.
 * With the property, expo-dev-launcher's release build takes its debug code and resources but not its
 * debug manifest (src/debug/AndroidManifest.xml, SDK 57), so the launcher's activities were undeclared
 * and the app crashed on start (ActivityNotFoundException, DevLauncherActivity). The app's manifest
 * declares them, and what else that manifest holds, instead; keep it in step with the library's.
 * React Native's dev support (loading the bundle from Metro, Fast Refresh, the dev menu's reload) follows
 * ReactBuildConfig.DEBUG unless MainApplication says otherwise; in a release build it is off, and the
 * launcher could not load from Metro (ReleaseDevSupportManager). So MainApplication turns it on, and the
 * manifest allows cleartext HTTP for Metro on the LAN, as the debug build's manifest does.
 */
const DEV_LAUNCHER = "expo.modules.devlauncher";
const withDevSupportInRelease = (config: ExpoConfig): ExpoConfig =>
  withMainApplication(config, (c) => {
    let src = c.modResults.contents;
    if (src.includes("useDevSupport = true")) return c;
    const re = /(ExpoReactHostFactory\.getDefaultReactHost\(\s*\n(\s*)context = applicationContext,)/;
    // A template that no longer matches must fail the build, not ship a dev client that cannot load.
    if (!re.test(src)) throw new Error(`withDevSupportInRelease: MainApplication has no match for ${re}`);
    src = src.replace(re, "$1\n$2useDevSupport = true,");
    c.modResults.contents = src;
    return c;
  }) as ExpoConfig;
const withDevClientInRelease = (config: ExpoConfig): ExpoConfig =>
  withAndroidManifest(
    withGradleProperties(withDevSupportInRelease(config), (c) => {
      for (const key of ["expo.devlauncher.configureInRelease", "expo.devmenu.configureInRelease"]) {
        c.modResults = c.modResults.filter((p) => !(p.type === "property" && p.key === key));
        c.modResults.push({ type: "property", key, value: "true" });
      }
      return c;
    }) as ExpoConfig,
    (c) => {
      type Node = { $: Record<string, string>; [child: string]: unknown };
      const m = c.modResults.manifest as unknown as {
        "uses-permission"?: Node[];
        queries?: { package?: Node[] }[];
        application?: { activity?: Node[]; "meta-data"?: Node[] }[];
      };
      const app = m.application?.[0];
      if (!app) throw new Error("withDevClientInRelease: AndroidManifest.xml has no <application>");
      (app as unknown as Node).$["android:usesCleartextTraffic"] = "true";
      const add = (list: Node[], node: Node) => {
        if (!list.some((n) => n.$["android:name"] === node.$["android:name"])) list.push(node);
      };
      const activities = (app.activity ??= []);
      const plain = { "android:exported": "true", "android:launchMode": "singleTask", "android:theme": "@style/Theme.AppCompat.DayNight.NoActionBar" };
      add(activities, { $: { "android:name": `${DEV_LAUNCHER}.launcher.DevLauncherActivity`, ...plain } });
      add(activities, {
        $: { "android:name": `${DEV_LAUNCHER}.compose.AuthActivity`, ...plain },
        "intent-filter": [
          {
            action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
            category: [{ $: { "android:name": "android.intent.category.DEFAULT" } }, { $: { "android:name": "android.intent.category.BROWSABLE" } }],
            data: [{ $: { "android:scheme": "expo-dev-launcher" } }],
          },
        ],
      });
      add(activities, {
        $: {
          "android:name": `${DEV_LAUNCHER}.launcher.errors.DevLauncherErrorActivity`,
          "android:screenOrientation": "portrait",
          "android:theme": "@style/Theme.DevLauncher.ErrorActivity",
        },
      });
      add((app["meta-data"] ??= []), { $: { "android:name": "com.google.mlkit.vision.DEPENDENCIES", "android:value": "barcode_ui" } });
      add((m["uses-permission"] ??= []), { $: { "android:name": "android.permission.CHANGE_WIFI_MULTICAST_STATE" } });
      const queries = (m.queries ??= [{}]);
      const packages = (queries[0].package ??= []);
      add(packages, { $: { "android:name": "host.exp.exponent" } });
      return c;
    },
  ) as ExpoConfig;

/** Every build's config plugins of our own. */
const withOwnPlugins = (config: ExpoConfig): ExpoConfig => withUncappedLocation(withReleaseSigning(config));

/**
 * The builds besides production (app.json), by APP_VARIANT. Each has its own package id, so it sits next
 * to the production app with its own storage instead of replacing it, and its own icon colour tells them
 * apart in the drawer (assets/icons, #249):
 * - development: the dev client "OpenClapper Dev", loads the JavaScript from Metro (make mobile). A release
 *   build signed with the deployment's key, from Google Play's internal track (Build phone app, variant dev).
 * - development-local: the same dev client built without a key (make dev-build, or Build phone app with
 *   variant dev and no key), debug-signed. Android installs no update signed with another key, so it has
 *   its own package id and sits next to the Play one; both share the scheme, so Metro opens either.
 * - staging: "OpenClapper Staging" for a staging instance, built by the Build phone app workflow and signed
 *   with the deployment's key like production.
 * - local: "OpenClapper Local" (make apk-local), the JavaScript inside and signed with the template's
 *   debug key, so anyone can build it from a fresh clone without a secret; it updates no other build.
 */
const VARIANTS: Record<string, { name: string; slug: string; package: string; icons: string; background: string }> = {
  development: { name: "OpenClapper Dev", slug: "dev", package: "org.openclapper.dev", icons: "dev", background: "#3B7A1A" },
  "development-local": { name: "OpenClapper Dev Local", slug: "dev", package: "org.openclapper.dev.local", icons: "dev", background: "#3B7A1A" },
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
  if (!name) return withOwnPlugins(app);
  const v = VARIANTS[name];
  // A typo must not silently build the production app.
  if (!v) throw new Error(`APP_VARIANT=${name}: expected one of ${Object.keys(VARIANTS).join(", ")}, or unset for production`);
  const icons = `./assets/icons/${v.icons}`;
  const variant = withOwnPlugins({
    ...app,
    name: v.name,
    scheme: `openclapper-${v.slug}`,
    icon: `${icons}/app-icon-1024.png`,
    android: {
      ...app.android,
      ...(name === "staging" || name === "development" ? { versionCode: buildTimeVersionCode() } : {}),
      package: v.package,
      adaptiveIcon: {
        backgroundColor: v.background,
        foregroundImage: `${icons}/android-adaptive-foreground-1024.png`,
        monochromeImage: `${icons}/android-adaptive-monochrome-1024.png`,
      },
    },
  });
  return name === "development" ? withDevClientInRelease(variant) : variant;
};
