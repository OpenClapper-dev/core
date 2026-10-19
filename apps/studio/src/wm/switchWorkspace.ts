import { withViewTransition } from "@fielder/ui";
import * as wm from "./wm";

/**
 * Switches workspaces with a crossfade of the whole desktop (a View Transition, #165). Meanwhile
 * `.wm-root.is-switching` keeps the windows and taskbar buttons that appear from playing their own
 * entrance on top of it (motion.css).
 */
export function goToWorkspace(to: string | 1 | -1): void {
  const root = document.querySelector(".wm-root");
  root?.classList.add("is-switching");
  void withViewTransition(() => wm.switchWorkspace(to)).then(() => root?.classList.remove("is-switching"));
}
