/**
 * The phone's composition root for extensions (docs/rewrite/08-extensions.md): the one file that may import
 * extension code. Each extension registers its apps, link channels and sync tasks through the core's
 * registration points; which of it shows depends on the active project's switches.
 */
import "@openclapper/ext-hardware";
