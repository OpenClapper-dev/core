import pkg from "../../../package.json" with { type: "json" };

declare const __FIELDER_COMMIT__: string | undefined;

/**
 * What is running: the product version (the root package.json, one for every part, docs/releasing.md)
 * and the commit it was deployed from, a wrangler `define` that scripts/deploy-config.mjs writes into
 * the deploy configs ("dev" in local development, where there is none).
 */
export const BUILD = {
  version: pkg.version,
  commit: typeof __FIELDER_COMMIT__ === "string" ? __FIELDER_COMMIT__ : "dev",
};
