import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json holds the config; this only renames the development build (APP_VARIANT=development, set by
 * the dev-client profile in eas.json and by `make mobile`). Its own package id lets "Fielder Dev" sit
 * next to the production app instead of replacing it, with its own storage.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const base = config as ExpoConfig;
  if (process.env.APP_VARIANT !== "development") return base;
  return {
    ...base,
    name: "Fielder Dev",
    scheme: "fielder-dev",
    android: { ...base.android, package: "app.fielder.scout.dev" },
  };
};
