import type { ComponentChildren, JSX } from "preact";
import { ResizablePanel } from "../layout/ResizablePanel";
import { cx } from "../util";

/** Window template: resizable sidebar, toolbar, a grid or list of items, status bar. For apps that browse a collection. */
export interface BrowserLayoutProps extends JSX.HTMLAttributes<HTMLDivElement> {
  toolbar?: ComponentChildren;
  sidebar?: ComponentChildren;
  sidebarWidth?: number;
  statusBar?: ComponentChildren;
  children?: ComponentChildren;
}

export function BrowserLayout({ toolbar, sidebar, sidebarWidth = 168, statusBar, children, className, ...rest }: BrowserLayoutProps) {
  return (
    <div className={cx("oc-app", className)} {...rest}>
      {toolbar}
      <div className="oc-app__body">
        {sidebar && <ResizablePanel defaultSize={sidebarWidth} min={120} max={320} className="oc-app__side">{sidebar}</ResizablePanel>}
        <div className="oc-app__main">{children}</div>
      </div>
      {statusBar}
    </div>
  );
}
