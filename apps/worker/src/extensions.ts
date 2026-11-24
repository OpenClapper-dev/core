/**
 * The Worker's composition root for extensions (docs/rewrite/08-extensions.md): the one file that may import
 * extension code. Every extension is compiled in and registered here, whatever a project has switched on;
 * its routes and tables are its own.
 */
import "@openclapper/ext-hardware";
import type { Router } from "@openclapper/service-kit";
import type { Ctx } from "./index.ts";
import { registerHardwareRoutes } from "./ext/hardware/routes.ts";

/** Registers the routes extensions bring. */
export function registerExtensionRoutes(r: Router<Ctx>): void {
  registerHardwareRoutes(r);
}
