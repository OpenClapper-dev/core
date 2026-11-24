/**
 * The phone's composition root for extensions (docs/rewrite/08-extensions.md): the one file that may import
 * extension code. Each extension registers its apps, link channels and sync tasks through the core's
 * registration points; which of it shows depends on the active project's switches. Imported after the core's
 * apps, so an extension's sync task runs after the upload queue.
 */
import "@openclapper/ext-hardware";
import "./ext/hardware";
