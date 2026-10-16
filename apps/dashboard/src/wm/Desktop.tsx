import { launch } from "../apps/registry";
import { useTheme } from "../theme";
import { ContextMenu, MenuItem, useCtxMenu } from "../ui";
import * as wm from "./wm";

/**
 * The layer behind the windows. Icons (server-side desktop_items) arrive with phase 6; for now it
 * is the wallpaper plus a right-click menu.
 */
export function Desktop() {
  const { menu, openMenu, closeMenu } = useCtxMenu<null>();
  const [theme, setTheme] = useTheme();
  return (
    <div class="wm-desktop" onMouseDown={(e) => { if (e.target === e.currentTarget) wm.focusDesktop(); }} onContextMenu={(e) => { if (e.target === e.currentTarget) openMenu(e, null); }}>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label="Desktop" onClose={closeMenu}>
          <MenuItem icon="cog-outline" onClick={() => launch({ app: "settings" })}>Settings</MenuItem>
          <MenuItem icon="theme-light-dark" onClick={() => setTheme(theme === "set" ? "sun" : "set")}>{theme === "set" ? "Sun theme" : "Set theme"}</MenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
