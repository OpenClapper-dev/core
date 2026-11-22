import type { ComponentChildren, JSX } from "preact";
import { ResizablePanel } from "../layout/ResizablePanel";
import { cx } from "../util";

/** Window template: one item large on a black stage, with an inspector on the right and an optional strip below. */
export interface ViewerLayoutProps extends JSX.HTMLAttributes<HTMLDivElement> {
  toolbar?: ComponentChildren;
  /** Content on black: an image, a frame, a map. */
  stage?: ComponentChildren;
  inspector?: ComponentChildren;
  inspectorWidth?: number;
  /** How far the inspector can be dragged. */
  inspectorMin?: number;
  inspectorMax?: number;
  /** The inspector can be closed to a rail; with inspectorCollapsed and onInspectorCollapsed a button elsewhere can do the same. */
  inspectorCollapsible?: boolean;
  inspectorCollapsed?: boolean;
  onInspectorCollapsed?: (collapsed: boolean) => void;
  /** Optional filmstrip under the stage. */
  strip?: ComponentChildren;
  statusBar?: ComponentChildren;
}

export function ViewerLayout({ toolbar, stage, inspector, inspectorWidth = 240, inspectorMin = 180, inspectorMax = 640, inspectorCollapsible, inspectorCollapsed, onInspectorCollapsed, strip, statusBar, className, ...rest }: ViewerLayoutProps) {
  return (
    <div className={cx("oc-app", className)} {...rest}>
      {toolbar}
      <div className="oc-app__body">
        <div className="oc-app__main" style={{ overflow: "hidden" }}>
          <div className="oc-app__stage">{stage}</div>
          {strip && <div className="oc-app__strip">{strip}</div>}
        </div>
        {inspector && <ResizablePanel side="right" defaultSize={inspectorWidth} min={inspectorMin} max={inspectorMax} collapsible={inspectorCollapsible} collapsed={inspectorCollapsed} onCollapsedChange={onInspectorCollapsed}>{inspector}</ResizablePanel>}
      </div>
      {statusBar}
    </div>
  );
}
