import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json holds the config. This renames the development build (APP_VARIANT=development, set by the
 * dev-client profile in eas.json and by `make mobile`): its own package id lets "Fielder Dev" sit next
 * to the production app instead of replacing it, with its own storage. EAS_OWNER and EAS_PROJECT_ID
 * point a self-hoster's build at their own Expo project without editing app.json (docs/self-hosting.md).
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  const project: ExpoConfig = {
    ...base,
    owner: process.env.EAS_OWNER || base.owner,
    extra: { ...base.extra, eas: { ...base.extra?.eas, projectId: process.env.EAS_PROJECT_ID || base.extra?.eas?.projectId } },
  };
  if (process.env.APP_VARIANT !== "development") return project;
  return {
    ...project,
    name: "Fielder Dev",
    scheme: "fielder-dev",
    android: { ...base.android, package: "app.fielder.scout.dev" },
  };
};
