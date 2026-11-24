/**
 * The Studio's composition root for extensions (docs/rewrite/08-extensions.md): the one file that may
 * import extension code. Each extension registers what it brings (apps, device kinds and views, phone tabs)
 * through the core's registration points; which of it shows depends on the project's switches.
 */
import "@openclapper/ext-hardware";
import "./ext/hardware";
