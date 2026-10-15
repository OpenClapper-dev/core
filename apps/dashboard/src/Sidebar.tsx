import { Fragment } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Project, SavedView } from "./api";
import type { LibrarySection, Route } from "./router";
import type { ThemeChoice } from "./theme";
import { Button, cx, Icon, IconButton, Kbd, Mark, MenuItem, useOutsideClick } from "./ui";

/** The id of the project the dashboard works in (issue #44: always one). */
type Scope = string;

interface Props {
  route: Route;
  rail: boolean;
  /** Collapse to the rail or expand (Ctrl/⌘ B). */
  onToggle: () => void;
  scope: Scope;
  projects: Project[];
  views: SavedView[];
  /** The saved view with unsaved edits, if any. */
  editedViewId: string | null;
  counts: { shots: number; unreviewed: number; projects: number; fields: number; rigs: number; locations: number };
  theme: ThemeChoice;
  onTheme: (t: ThemeChoice) => void;
  onScope: (s: Scope) => void;
  onNavigate: (r: Route) => void;
  onNewView: () => void;
  onPalette: () => void;
  onReload: () => void;
  loadedAt: Date | null;
}

const THEME_NEXT: Record<ThemeChoice, ThemeChoice> = { auto: "sun", sun: "set", set: "auto" };
const THEME_LABEL: Record<ThemeChoice, string> = { auto: "Theme: Auto (follows the system)", sun: "Theme: Sun", set: "Theme: Set" };
const THEME_ICON: Record<ThemeChoice, string> = { auto: "theme-light-dark", sun: "white-balance-sunny", set: "weather-night" };

/** Left sidebar (a 56 px rail when collapsed): scope, sections, saved views, palette, theme, reload, collapse. */
export function Sidebar({ route, rail, onToggle, scope, projects, views, editedViewId, counts, theme, onTheme, onScope, onNavigate, onNewView, onPalette, onReload, loadedAt }: Props) {
  const scopeName = projects.find((p) => p.id === scope)?.name ?? "—";
  const section = route.page === "shot" ? "shots" : route.page;
  const lib = route.page === "library" ? route.section : null;
  const viewId = route.page === "shots" ? route.viewId : null;
  const nav = (id: string, icon: string, text: string, to: Route, count?: number, warn?: boolean) => (
    <a class={cx("f-nav", section === id && !(id === "shots" && viewId) && "is-current")} href="#" aria-label={rail ? `${text}${count ? `, ${count}` : ""}` : undefined} title={rail ? text : undefined}
      aria-current={section === id ? "page" : undefined} onClick={(e) => { e.preventDefault(); onNavigate(to); }}>
      <Icon name={icon} />{!rail && <span class="f-nav__txt">{text}</span>}
      {count !== undefined && (warn ? count > 0 && <span class="f-nav__count f-nav__count--warn">{count}</span> : !rail && <span class="f-nav__count">{count}</span>)}
    </a>
  );
  const sub = (s: LibrarySection, text: string, count: number) => (
    <a class={cx("f-nav f-nav--sub", lib === s && "is-current")} href="#" onClick={(e) => { e.preventDefault(); onNavigate({ page: "library", section: s, id: null }); }}>
      <span class="f-nav__txt">{text}</span><span class="f-nav__count">{count}</span>
    </a>
  );
  return (
    <nav class="f-side" aria-label="Sections">
      <div class="f-side__brand" style={rail ? { padding: 0, justifyContent: "center" } : undefined}>
        <Mark />{!rail && <span style={{ flex: 1 }}>Fielder</span>}
        {!rail && <IconButton icon="chevron-double-left" label="Collapse the sidebar (Ctrl B)" title="Collapse the sidebar (Ctrl B)" onClick={onToggle} />}
      </div>
      <ScopeSwitch rail={rail} scope={scope} name={scopeName} projects={projects} onScope={onScope} onManage={() => onNavigate({ page: "library", section: "projects", id: null })} />
      <div style={{ height: "10px" }} />
      {nav("shots", "view-grid-outline", "Shots", { page: "shots", viewId: null }, counts.shots)}
      {nav("timeline", "filmstrip", "Timeline", { page: "timeline", timelineId: null }, counts.unreviewed, true)}
      {nav("metadata", "tag-multiple-outline", "Metadata", { page: "metadata", field: "location" })}
      {nav("plan", "calendar-clock", "Plan", { page: "plan", dayId: null })}
      {nav("library", "bookshelf", "Library", { page: "library", section: lib ?? "projects", id: null })}
      {!rail && section === "library" && (
        <>
          {sub("projects", "Projects", counts.projects)}
          {sub("fields", "Fields", counts.fields)}
          {sub("rigs", "Rigs", counts.rigs)}
          {sub("locations", "Locations", counts.locations)}
        </>
      )}
      {!rail && (
        <>
          <div class="f-side__label">
            <span>Saved views</span>
            <IconButton icon="plus" label="New view" title="New view: build a filter in Shots and save it" style={{ height: "22px", width: "22px", margin: "-4px -4px -4px 0" }} onClick={onNewView} />
          </div>
          {views.length === 0 && <span class="meta" style={{ padding: "2px 10px" }}>Filter shots, then save the filter as a view.</span>}
          {views.map((v) => (
            <a key={v.id} class={cx("f-nav f-nav--sub", viewId === v.id && "is-current")} style={{ paddingLeft: "12px" }} href="#" onClick={(e) => { e.preventDefault(); onNavigate({ page: "shots", viewId: v.id }); }}>
              <Icon name="filter-variant" size={16} /><span class="f-nav__txt">{v.name}</span>
              {editedViewId === v.id && <span class="f-nav__dot" title="Unsaved changes" />}
            </a>
          ))}
        </>
      )}
      <div class="f-side__grow" />
      {rail ? (
        <>
          <button type="button" class="f-nav" aria-label="Go to… (⌘K)" title="Go to… (⌘K)" onClick={onPalette}><Icon name="magnify" /></button>
          <button type="button" class="f-nav" aria-label={THEME_LABEL[theme]} title={THEME_LABEL[theme]} onClick={() => onTheme(THEME_NEXT[theme])}><Icon name={THEME_ICON[theme]} /></button>
          <button type="button" class={cx("f-nav", section === "settings" && "is-current")} aria-label="Settings" title="Settings" onClick={() => onNavigate({ page: "settings", tab: "general" })}><Icon name="cog-outline" /></button>
          <button type="button" class="f-nav" aria-label="Reload data" title="Reload data" onClick={onReload}><Icon name="refresh" /></button>
          <button type="button" class="f-nav" aria-label="Expand the sidebar (Ctrl B)" title="Expand the sidebar (Ctrl B)" onClick={onToggle}><Icon name="chevron-double-right" /></button>
        </>
      ) : (
        <div class="f-side__foot">
          <Button kind="secondary" size="sm" icon="magnify" style={{ flex: 1, justifyContent: "flex-start" }} onClick={onPalette}>Go to…<span style={{ marginLeft: "auto" }}><Kbd>⌘K</Kbd></span></Button>
          <IconButton icon={THEME_ICON[theme]} label={THEME_LABEL[theme]} title={THEME_LABEL[theme]} onClick={() => onTheme(THEME_NEXT[theme])} />
          <IconButton icon="cog-outline" label="Settings" title="Settings" aria-current={section === "settings" ? "page" : undefined} onClick={() => onNavigate({ page: "settings", tab: "general" })} />
          <IconButton icon="refresh" label="Reload data" title={loadedAt ? `Reload data (loaded ${loadedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : "Reload data"} onClick={onReload} />
        </div>
      )}
    </nav>
  );
}

/** Project switcher: a listbox of projects and "Manage projects…". */
function ScopeSwitch({ rail, scope, name, projects, onScope, onManage }: { rail: boolean; scope: Scope; name: string; projects: Project[]; onScope: (s: Scope) => void; onManage: () => void }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const items: { id: string; label: string; icon: string; meta?: string }[] = [
    ...projects.map((p) => ({ id: p.id, label: p.name, icon: "folder-outline", meta: `${p.shot_count}` })),
    { id: "__manage__", label: "Manage projects…", icon: "cog-outline" },
  ];
  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, items.findIndex((i) => i.id === scope)));
    const b = box.current?.getBoundingClientRect();
    if (b) setAt({ top: b.bottom + 4, left: b.left, width: rail ? 260 : b.width });
  }, [open]);
  useOutsideClick(() => box.current, () => setOpen(false), open);
  const take = (id: string) => { setOpen(false); if (id === "__manage__") onManage(); else onScope(id); };
  const onKey = (e: KeyboardEvent) => {
    if (!open) { if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(true); } return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); take(items[hi].id); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
  };
  return (
    <div ref={box} style={{ position: "relative", width: "100%" }} onKeyDown={onKey}>
      {rail ? (
        <button type="button" class="f-nav" style={{ border: "1px solid var(--border)" }} aria-label={`Project: ${name}`} title={name} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="folder-outline" /></button>
      ) : (
        <button type="button" class="f-scope" aria-haspopup="listbox" aria-expanded={open} title="Switch project (⌘K → project)" onClick={() => setOpen(!open)}>
          <span class="f-scope__main"><span class="f-scope__lbl">Project</span><span class="f-scope__name">{name}</span></span>
          <Icon name="unfold-more-horizontal" />
        </button>
      )}
      {open && at && (
        <div class="f-menu" role="listbox" style={{ position: "fixed", top: `${at.top}px`, left: `${at.left}px`, zIndex: 60, width: `${at.width}px`, maxHeight: "60vh", overflow: "auto" }}>
          {items.map((it, i) => (
            <Fragment key={it.id}>
              {it.id === "__manage__" && <div class="f-menu__sep" />}
              <MenuItem role="option" aria-selected={it.id === scope} icon={it.id === scope ? "check" : it.icon} highlighted={i === hi} selected={it.id === scope} count={it.meta}
                onMouseEnter={() => setHi(i)} onClick={() => take(it.id)}>{it.label}</MenuItem>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
