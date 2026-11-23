import type { ComponentChildren, JSX } from "preact";
import { Dock, type DockProps } from "../layout/Dock";
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
  /** How far the inspector can be dragged. */
  inspectorMin?: number;
  inspectorMax?: number;
  /** The inspector can be closed to a rail; with inspectorCollapsed and onInspectorCollapsed a button elsewhere can do the same. */
  inspectorCollapsible?: boolean;
  inspectorCollapsed?: boolean;
  onInspectorCollapsed?: (collapsed: boolean) => void;
  /** Panels the user arranges around the canvas (see Dock), in place of the fixed inspector. */
  dock?: Omit<DockProps, "children">;
  statusBar?: ComponentChildren;
}

export function EditorLayout({ toolbar, toolRail, canvas, inspector, inspectorWidth = 220, inspectorMin = 180, inspectorMax = 640, inspectorCollapsible, inspectorCollapsed, onInspectorCollapsed, dock, statusBar, className, ...rest }: EditorLayoutProps) {
  return (
    <div className={cx("oc-app", className)} {...rest}>
      {toolbar}
      {dock ? <Dock {...dock}>{toolRail}<div className="oc-app__canvas">{canvas}</div></Dock> : <div className="oc-app__body">
        {toolRail}
        <div className="oc-app__canvas">{canvas}</div>
        {inspector && <ResizablePanel side="right" defaultSize={inspectorWidth} min={inspectorMin} max={inspectorMax} collapsible={inspectorCollapsible} collapsed={inspectorCollapsed} onCollapsedChange={onInspectorCollapsed}>{inspector}</ResizablePanel>}
      </div>}
      {statusBar}
    </div>
  );
}
