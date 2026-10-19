import Constants from "expo-constants";

const commit = (Constants.expoConfig?.extra as { commit?: string } | undefined)?.commit;

/** The product version and the commit this build was made from (app.config.ts), for the Setup footer and the debug log. */
export const APP_VERSION = `${Constants.expoConfig?.version ?? "?"}${commit ? ` (${commit})` : ""}`;
