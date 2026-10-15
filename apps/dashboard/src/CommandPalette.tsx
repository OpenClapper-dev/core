import { Fragment } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Location, Project, SavedView, Shot, ShootingDay } from "./api";
import { cover, placeLabel, shotTitle } from "./format";
import { Framed } from "./Framed";
import { cx, Highlight, Icon, IconButton, Kbd, Modal, Overlay } from "./ui";

export interface Command { id: string; group: string; icon: string; title: string; sub?: string; shot?: Shot; keys?: string; run: () => void }

interface Props {
  shots: Shot[];
  locations: Location[];
  views: SavedView[];
  projects: Project[];
  days: ShootingDay[];
  actions: Command[];
  onOpenShot: (s: Shot) => void;
  onLocation: (l: Location) => void;
  onView: (v: SavedView) => void;
  onProject: (p: Project) => void;
  onDay: (d: ShootingDay) => void;
  onClose: () => void;
}

const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** ⌘K: jump to a shot, location, view, project or day, or run an action. */
export function CommandPalette(p: Props) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const query = q.trim().toLowerCase();
  const has = (...t: (string | null | undefined)[]) => !query || t.some((x) => x?.toLowerCase().includes(query));
  const items = useMemo((): Command[] => {
    const out: Command[] = [];
    const shots = p.shots.filter((s) => has(shotTitle(s), placeLabel(s))).slice(0, query ? 8 : 4);
    out.push(...shots.map((s): Command => ({ id: `s${s.id}`, group: "Shots", icon: "image-outline", title: shotTitle(s), sub: [placeLabel(s), s.project_name].filter(Boolean).join(" · "), shot: s, run: () => p.onOpenShot(s) })));
    if (query) out.push(...p.locations.filter((l) => has(l.name)).slice(0, 5).map((l): Command => ({ id: `l${l.id}`, group: "Locations", icon: "map-marker-outline", title: l.name, sub: `${l.shot_count} shots`, run: () => p.onLocation(l) })));
    out.push(...p.views.filter((v) => has(v.name)).slice(0, 5).map((v): Command => ({ id: `v${v.id}`, group: "Views", icon: "filter-variant", title: v.name, run: () => p.onView(v) })));
    out.push(...p.days.filter((d) => has(d.title, dayLabel(d.date), d.date)).slice(0, 5).map((d): Command => ({ id: `d${d.id}`, group: "Days", icon: "calendar-outline", title: `${dayLabel(d.date)}${d.title ? ` · ${d.title}` : ""}`, sub: `${d.shots.length} shots`, run: () => p.onDay(d) })));
    out.push(...p.projects.filter((pr) => has(pr.name, "switch project", "scope")).slice(0, 6).map((pr): Command => ({ id: `p${pr.id}`, group: "Switch project", icon: "folder-outline", title: pr.name, sub: `${pr.shot_count} shots`, run: () => p.onProject(pr) })));
    out.push(...p.actions.filter((a) => has(a.title, a.sub)));
    return out;
  }, [query, p.shots, p.locations, p.views, p.days, p.projects, p.actions]);
  useEffect(() => { setHi(0); }, [query]);
  useEffect(() => { list.current?.querySelector(".is-hi")?.scrollIntoView({ block: "nearest" }); }, [hi]);
  const run = (c: Command | undefined) => { if (!c) return; p.onClose(); c.run(); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); run(items[hi]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); p.onClose(); }
  };
  let lastGroup = "";
  return (
    <Overlay top onClose={p.onClose} onKeyDown={onKey}>
      <div class="f-cmdk" role="dialog" aria-modal="true" aria-label="Go to">
        <div class="f-cmdk__input"><Icon name="magnify" /><input autoFocus value={q} placeholder="Go to a shot, location, view, day or project… or run an action" aria-label="Search" onInput={(e) => setQ((e.target as HTMLInputElement).value)} /><Kbd>Esc</Kbd></div>
        <div class="f-cmdk__list" ref={list} role="listbox">
          {items.length === 0 && <div class="f-cmdk__group">Nothing found</div>}
          {items.map((c, i) => {
            const head = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <Fragment key={c.id}>
                {head && <div class="f-cmdk__group">{head}</div>}
                <div role="option" aria-selected={i === hi} class={cx("f-cmdk__item", i === hi && "is-hi")} onMouseEnter={() => setHi(i)} onClick={() => run(c)}>
                  {c.shot ? <div class="f-cmdk__thumb"><Framed photo={cover(c.shot)} mode="frame" /></div> : <Icon name={c.icon} />}
                  <div class="f-cmdk__main"><b><Highlight text={c.title} q={query} /></b>{c.sub && <small>{c.sub}</small>}</div>
                  {c.keys && <Kbd>{c.keys}</Kbd>}
                </div>
              </Fragment>
            );
          })}
        </div>
        <div class="f-cmdk__foot"><span><Kbd>↑</Kbd> <Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> open</span><span><Kbd>Esc</Kbd> close</span></div>
      </div>
    </Overlay>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  ["Everywhere", [["⌘K / Ctrl K", "Go to…"], ["?", "This sheet"], ["G then S · T · P · L · M", "Shots · Timeline · Plan · Library · Map"], ["/", "Focus search"], ["M", "Cycle the frame mode"], ["Ctrl B / ⌘B", "Collapse or expand the sidebar"], ["Esc", "Close or back out one level"]]],
  ["Shots", [["F", "Filter panel"], ["← ↑ → ↓", "Move in the grid"], ["J / K", "Move in the list"], ["X · ⇧X", "Select · select range"], ["↵", "Open"], ["E", "Edit selected"], ["⇧M", "Move selected"], ["Del", "Delete selected"]]],
  ["Shot view", [["← / →", "Previous / next shot"], [", / .", "Previous / next photo"], ["A", "Approve"], ["E", "Archive / back to review"], ["R", "Framing stage"], ["C", "Compose"]]],
  ["Plan", [["↑ / ↓", "Move between planned shots"], ["Alt ↑ / ↓", "Reorder"], ["T", "Planned time"], ["Del", "Remove from the day"], ["N", "Add shots"], ["⇧N", "New day"]]],
  ["Timeline", [["← / →", "Previous / next clip"], ["Space", "Play / pause"], ["Drag", "Shots into the strip · reorder clips · ruler scrubs"], ["Alt ← / →", "Reorder"], ["A / E", "Approve / archive the browser's shot"], ["R / C", "Re-frame / compose the clip"], ["D", "Hold time"], ["Del", "Remove clip"], ["N", "Shots panel ⇄ clip panel"], ["P", "Placeholder"], ["⇧N", "New timeline"], ["↵", "Open the shot"], ["Right-click", "Actions on shots, clips, timelines"]]],
  ["Compose (shot view)", [["C", "Open Compose"], ["V · P · L · A · R · O · T · S · E", "Select · Pen · Line · Arrow · Rectangle · Ellipse · Text · Stencil · Eraser"], ["1 – 0", "Colour"], ["⌘Z / ⌘⇧Z", "Undo / redo"], ["Del", "Remove the selected shape"], [", .", "Photo of the sequence"], ["⌘S", "Save"], ["Esc", "Deselect · close · back"]]],
  ["Combobox", [["↑ / ↓", "Move"], ["↵ / Tab", "Take the highlighted entry"], ["Esc", "Cancel"]]],
];

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" width="720px" tabIndex={-1} modalRef={(el) => el?.focus()} onClose={onClose} onKeyDown={(e) => { if (e.key === "Escape" || e.key === "?") { e.stopPropagation(); onClose(); } }}
      headAction={<IconButton icon="close" label="Close (Esc)" size="md" onClick={onClose} />}>
        <div class="f-modal__body shortcut-grid">
          {SHORTCUTS.map(([group, rows]) => (
            <section key={group}><h3 class="section-title">{group}</h3><dl class="f-facts">{rows.map(([k, t]) => <Fragment key={k}><dt><Kbd>{k}</Kbd></dt><dd>{t}</dd></Fragment>)}</dl></section>
          ))}
          <p class="meta" style={{ gridColumn: "1 / -1", margin: 0 }}>Single keys never fire while you type in a field.</p>
        </div>
    </Modal>
  );
}
