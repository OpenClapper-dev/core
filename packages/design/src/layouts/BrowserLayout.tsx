import type { ComponentChildren, JSX } from "preact";
import { ResizablePanel } from "../layout/ResizablePanel";
import { cx } from "../util";

/** Window template: resizable sidebar, toolbar, a grid or list of items, status bar. For apps that browse a collection. */
export interface BrowserLayoutProps extends JSX.HTMLAttributes<HTMLDivElement> {
  toolbar?: ComponentChildren;
  sidebar?: ComponentChildren;
  sidebarWidth?: number;
  /** How far the sidebar can be dragged. */
  sidebarMin?: number;
  sidebarMax?: number;
  statusBar?: ComponentChildren;
  children?: ComponentChildren;
}

export function BrowserLayout({ toolbar, sidebar, sidebarWidth = 168, sidebarMin = 120, sidebarMax = 320, statusBar, children, className, ...rest }: BrowserLayoutProps) {
  return (
    <div className={cx("oc-app", className)} {...rest}>
      {toolbar}
      <div className="oc-app__body">
        {sidebar && <ResizablePanel defaultSize={sidebarWidth} min={sidebarMin} max={sidebarMax} className="oc-app__sidepanel">{sidebar}</ResizablePanel>}
        <div className="oc-app__main">{children}</div>
      </div>
      {statusBar}
    </div>
  );
}
