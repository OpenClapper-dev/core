import { useEffect, useRef } from "preact/hooks";
import { APPS, launch, type AppId } from "../apps/registry";
import { ContextMenu, Icon, MenuItem, useCtxMenu, useOutsideClick } from "../ui";
import * as wm from "./wm";

/** The launcher popover above the taskbar: every registered app; right-click pins to the taskbar. */
export function Launcher({ onClose }: { onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const pins = wm.usePins();
  const { menu, openMenu, closeMenu } = useCtxMenu<AppId>();
  useOutsideClick(() => box.current, onClose);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, []);
  useEffect(() => { box.current?.querySelector("button")?.focus(); }, []);
  return (
    <>
      <div ref={box} class="wm-launcher" role="menu" aria-label="Apps">
        <div class="wm-launcher__grid">
          {Object.values(APPS).map((d) => (
            <button key={d.id} type="button" class="wm-launcher__app" role="menuitem"
              onClick={() => { launch({ app: d.id }); onClose(); }} onContextMenu={(e) => openMenu(e, d.id)}>
              <Icon name={d.icon} size={26} />
              <span>{d.name}</span>
            </button>
          ))}
        </div>
      </div>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label="App actions" onClose={closeMenu}>
          <MenuItem icon="open-in-app" onClick={() => { launch({ app: menu.ctx }); onClose(); }}>Open</MenuItem>
          <MenuItem icon={pins.includes(menu.ctx) ? "pin-off-outline" : "pin-outline"} onClick={() => wm.togglePin(menu.ctx)}>
            {pins.includes(menu.ctx) ? "Unpin from taskbar" : "Pin to taskbar"}
          </MenuItem>
        </ContextMenu>
      )}
    </>
  );
}
