import type { ComponentChildren, JSX } from "preact";
import { ResizablePanel } from "../layout/ResizablePanel";
import { cx } from "../util";

/** Window template: tool rail, dotted canvas, inspector. For apps that draw or arrange. */
export interface EditorLayoutProps extends JSX.HTMLAttributes<HTMLDivElement> {
  toolbar?: ComponentChildren;
  /** A ToolRail. */
  toolRail?: ComponentChildren;
  canvas?: ComponentChildren;
  inspector?: ComponentChildren;
  inspectorWidth?: number;
  statusBar?: ComponentChildren;
}

export function EditorLayout({ toolbar, toolRail, canvas, inspector, inspectorWidth = 220, statusBar, className, ...rest }: EditorLayoutProps) {
  return (
    <div className={cx("oc-app", className)} {...rest}>
      {toolbar}
      <div className="oc-app__body">
        {toolRail}
        <div className="oc-app__canvas">{canvas}</div>
        {inspector && <ResizablePanel side="right" defaultSize={inspectorWidth} min={180} max={400}>{inspector}</ResizablePanel>}
      </div>
      {statusBar}
    </div>
  );
}
