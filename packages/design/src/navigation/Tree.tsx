import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { Icon } from "../core/Icon";
import type { IconName } from "../core/glyphs";
import { cx } from "../util";

/** One node of a Tree. */
export interface TreeNodeData { id: string; label: string; icon?: IconName; children?: TreeNodeData[] }

interface TreeNodeProps { node: TreeNodeData; depth: number; expanded: string[]; toggle: (id: string) => void; selected?: string; onSelect?: (id: string) => void }

function TreeNode({ node, depth, expanded, toggle, selected, onSelect }: TreeNodeProps) {
  const kids = node.children && node.children.length > 0;
  const open = expanded.includes(node.id);
  return (
    <>
      <div role="treeitem" aria-level={depth + 1} aria-expanded={kids ? open : undefined} aria-selected={selected === node.id} tabIndex={selected === node.id ? 0 : -1}
        className={cx("oc-row", "oc-tree__row", selected === node.id && "is-selected")} style={{ paddingLeft: 4 + depth * 16 }} onClick={() => onSelect && onSelect(node.id)}>
        {kids
          ? <button type="button" tabIndex={-1} className="oc-tree__twisty" aria-label={open ? "Collapse" : "Expand"} onClick={e => { e.stopPropagation(); toggle(node.id); }}><Icon name={open ? "chevron-down" : "chevron-right"} size={12} /></button>
          : <span className="oc-tree__twisty" />}
        {node.icon && <Icon name={node.icon} />}<span className="oc-row__main">{node.label}</span>
      </div>
      {kids && open ? node.children!.map(c => <TreeNode key={c.id} node={c} depth={depth + 1} expanded={expanded} toggle={toggle} selected={selected} onSelect={onSelect} />) : null}
    </>
  );
}

/** A hierarchy of folders or nested objects with expand and collapse. */
export interface TreeProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  nodes: TreeNodeData[];
  selected?: string;
  onSelect?: (id: string) => void;
  defaultExpanded?: string[];
}

export function Tree({ nodes = [], selected, onSelect, defaultExpanded = [], className, ...rest }: TreeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const toggle = (id: string) => setExpanded(x => x.includes(id) ? x.filter(i => i !== id) : x.concat(id));
  return <div role="tree" className={cx("oc-tree", className)} {...rest}>{nodes.map(n => <TreeNode key={n.id} node={n} depth={0} expanded={expanded} toggle={toggle} selected={selected} onSelect={onSelect} />)}</div>;
}
