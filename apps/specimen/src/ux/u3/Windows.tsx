// UX workshop U3, round 1: the shot, set and location windows. One build for all three: a stage that shows the chosen
// picture, the file's properties beside it, and below the content list and, for a shot, its progression (a small
// timeline with a generator, an overlay and a default frame). A canvas is edited in place: the canvas tool of U2 is
// mounted where the stage was. A prototype on fake data: no server, no product code.
// Specified in docs/rewrite/04-shots.md, 09a-places.md, i1-interjection.md and 06-timeline.md (hosting).
import "./u3.css";
import { useEffect, useState } from "preact/hooks";
import {
  AppIcon, Badge, Banner, Button, Confirm, DropdownMenu, EmptyState, Icon, NumberInput, Popover, PropertyList, PropertyRow, PropertySection, ResizablePanel, Segmented, Select, Slider, StatusBar, Switch, TextInput, Toast, Toolbar, ToolbarSpacer, cx,
} from "@openclapper/design";
import { TYPES, type FileRec } from "../u1/data";
import { ASPECTS, PRESETS } from "../u2/model";
import U2Canvas from "../u2/Canvas";
import AddFiles from "./AddFiles";
import Generator, { type Made } from "./Generator";
import { DOCS, START_FILES, START_PROGS, TABS, clock, describe, holds, type DefFrame, type Doc, type Item, type Prog, type Ref } from "./model";
import { Pic, see, type Mode } from "./Pic";
import { FileChip, FileProps } from "./Props";
import { moved, useSort } from "./sortable";

const SCALE = 120; // px per second in the progression
const SOURCE = { own: "its own frame", default: "the default frame", picture: "the canvas's picture", none: "no frame" };
type Pick = { list: "prog" | "content"; i: number };

export default function U3Windows() {
  const [files, setFiles] = useState<FileRec[]>(START_FILES);
  const [docs, setDocs] = useState<Record<string, Doc>>(DOCS);
  const [progs, setProgs] = useState<Record<string, Prog | undefined>>(START_PROGS);
  const [cur, setCur] = useState(TABS[0]);
  const [picked, setPick] = useState<Pick | null>(null);
  const [mode, setMode] = useState<Mode>("crop");
  const [tab, setTab] = useState("file");
  const [t, setT] = useState<number | null>(null);
  const [adding, setAdding] = useState<"content" | "prog" | null>(null);
  const [gen, setGen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const [release, setRelease] = useState<string | null>(null);
  const [binning, setBinning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState("dark");
  const [closed, setClosed] = useState(false);
  const [low, setLow] = useState(false);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast((x) => (x === m ? null : x)), 3200); };

  const map = new Map(files.map((f) => [f.id, f]));
  const file = map.get(cur)!, type = TYPES[file.type], shot = file.type === "shot";
  const prog = shot ? progs[cur] : undefined, content = file.content ?? [];
  const internal = files.filter((f) => f.internalOf === cur);
  const times = prog ? holds(prog) : [], total = times.reduce((a, b) => a + b, 0);
  const playing = t != null && prog ? Math.max(0, times.findIndex((_, i) => t < times.slice(0, i + 1).reduce((a, b) => a + b, 0))) : null;
  const fallback: Pick | null = prog?.items.length ? { list: "prog", i: 0 } : content.length ? { list: "content", i: 0 } : null;
  const sel: Pick | null = playing != null ? { list: "prog", i: playing } : picked && (picked.list === "prog" ? prog && picked.i < prog.items.length : picked.i < content.length) ? picked : fallback;
  const ref: Ref | null = !sel ? null : sel.list === "prog" ? prog!.items[sel.i] : { file: content[sel.i] };
  const item: Item | null = sel?.list === "prog" ? prog!.items[sel.i] : null;
  const seen = ref ? see(ref, map, docs, sel!.list === "prog" ? prog!.frame : null) : null;
  const entry = seen?.file && !seen.missing ? seen.file : null;
  const over = sel?.list === "prog" && !!prog?.overlay?.visible;
  const thumb: Ref | null = prog?.items[0] ?? (content.map((id) => map.get(id)).find((f) => f && !f.binned && (f.type === "photo" || f.type === "canvas")) ? { file: content.find((id) => { const f = map.get(id); return f && !f.binned && (f.type === "photo" || f.type === "canvas"); })! } : null);
  /** Everything that points at a file: content lists, progressions, reference properties. */
  const usedIn = (id: string) => files.filter((f) => !f.binned && f.id !== id && ((f.content ?? []).includes(id) || progs[f.id]?.items.some((i) => i.file === id) || progs[f.id]?.overlay?.file === id || Object.values(f.props).some((v) => (Array.isArray(v) ? v : [v]).includes(id))));

  useEffect(() => { if (t == null) return; if (t >= total) { setT(null); return; } const h = setTimeout(() => setT(Math.round((t + 0.1) * 10) / 10), 100); return () => clearTimeout(h); }, [t, total]);

  const patch = (id: string, c: Partial<FileRec>) => setFiles((now) => now.map((f) => (f.id === id ? { ...f, ...c } : f)));
  const setProp = (id: string, key: string, value: string | string[]) => patch(id, { props: { ...map.get(id)!.props, [key]: value } });
  const setProg = (p: Prog | undefined) => setProgs({ ...progs, [cur]: p });
  const open = (id: string) => { const f = map.get(id); if (!f) return; if (["shot", "set", "location"].includes(f.type)) { setCur(id); setPick(null); setT(null); done(); setTab("file"); } else say(`“${f.name}” opens in the ${TYPES[f.type].app} app, in a window of its own`); };
  const choose = (p: Pick) => { setT(null); setPick(p); const id = p.list === "prog" ? prog!.items[p.i].file : content[p.i]; if (editing) { if (map.get(id)?.type === "canvas") setEditing(id); else done(); } };
  // The canvas tool needs the room: the lists below fold away while it is mounted, and can be pulled up again.
  const edit = (id: string) => { setT(null); if (!editing) setLow(true); setEditing(id); };
  const done = () => { setEditing(null); setLow(false); };
  const emptyProg = (): Prog => ({ items: [], timing: "each", total: 0, overlay: null, frame: null });

  const addRefs = (refs: Ref[]) => {
    if (adding === "content") { const ids = [...new Set(refs.map((r) => r.file))].filter((id) => !content.includes(id)); patch(cur, { content: [...content, ...ids] }); say(ids.length ? `${ids.length} added to the content` : "Already in the content"); }
    else { const p = prog ?? emptyProg(), items = refs.map((r, i) => ({ ...r, id: `a${Date.now()}${i}`, hold: 1 })); setProg({ ...p, items: [...p.items, ...items], total: p.total + items.length }); setPick({ list: "prog", i: p.items.length }); }
    setAdding(null);
  };
  const newCanvas = () => {
    const n = files.filter((f) => f.type === "canvas").length + 1, id = `${cur}-c${n}`;
    setFiles([...files.map((f) => (f.id === cur ? { ...f, content: [...content, id] } : f)), { id, type: "canvas", name: `Canvas ${String(n).padStart(2, "0")}`, created: "2026-11-23 10:00", by: "Ada", props: {}, pic: 66, internalOf: cur, facts: [["Surface", "Blank, 16:9"]] }]);
    setFresh([...fresh, id]); setPick({ list: "content", i: content.length }); edit(id);
  };
  const generate = (m: Made) => {
    const id = `${cur}-series-${Date.now()}`, photo = map.get(m.photo)!;
    setFiles([...files, { id, type: "canvas", name: m.name || "Framing series", created: "2026-11-23 10:00", by: "Ada", props: {}, pic: photo.pic, internalOf: cur, facts: [["Surface", photo.name], ["Frames", String(m.frames.length)]] }]);
    setDocs({ ...docs, [id]: { base: m.photo, frames: m.frames } });
    const items = m.frames.map((f, i) => ({ id: `${id}-${i}`, file: id, frame: f.id, hold: m.hold })), p = prog ?? emptyProg();
    setProg(m.add ? { ...p, items: [...p.items, ...items], total: p.total + items.length * m.hold } : { ...p, items, timing: "each", total: items.length * m.hold });
    setPick({ list: "prog", i: m.add ? p.items.length : 0 }); setGen(false);
    say(`${m.frames.length} pictures from one internal canvas, “${m.name || "Framing series"}”`);
  };
  const addOverlay = () => { const id = `${cur}-overlay`; if (!map.has(id)) setFiles([...files, { id, type: "canvas", name: "Overlay", created: "2026-11-23 10:00", by: "Ada", props: {}, internalOf: cur, facts: [["Surface", "Blank"]] }]); setFresh([...fresh, id]); setProg({ ...prog!, overlay: { file: id, visible: true } }); };
  const setTiming = (timing: Prog["timing"]) => { if (!prog) return; setProg(timing === "each" ? { ...prog, timing, items: prog.items.map((i, n) => ({ ...i, hold: Math.max(0.5, Math.round(times[n] * 10) / 10) })) } : { ...prog, timing, total: Math.round(total * 10) / 10 }); };
  const stretch = (i: number) => (e: PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const sx = e.clientX, orig = prog!.items[i].hold;
    const move = (m: PointerEvent) => setProgs((now) => { const p = now[cur]!; return { ...now, [cur]: { ...p, items: p.items.map((it, n) => (n === i ? { ...it, hold: Math.max(0.5, Math.round((orig + (m.clientX - sx) / SCALE) * 2) / 2) } : it)) } }; });
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
  };
  const sortC = useSort("x", (a, b) => { patch(cur, { content: moved(content, a, b) }); setPick({ list: "content", i: b }); });
  const sortP = useSort("x", (a, b) => { setProg({ ...prog!, items: moved(prog!.items, a, b) }); setPick({ list: "prog", i: b }); });

  // The stage: the chosen picture, or the canvas tool mounted in its place.
  const editFile = editing ? map.get(editing) : undefined;
  const others = editing ? usedIn(editing).filter((f) => f.id !== cur) : [];
  const stage = !sel || !seen ? (
    <EmptyState icon={type.glyph} title={shot ? "A shot with a name only" : `Nothing gathered for this ${type.label.toLowerCase()} yet`} action={<span className="u3-bar"><Button icon="plus" onClick={() => setAdding("content")}>Add files</Button><Button icon="brush" onClick={newCanvas}>Draw a canvas</Button></span>}>{shot ? "It exists on its own. Add photos or canvases when there is a picture for it." : "Add photos, floor plans and other files that belong to it."}</EmptyState>
  ) : seen.missing ? (
    <EmptyState icon="warning" title={seen.file ? `“${seen.file.name}” is in the recycle bin` : "This file no longer exists"} action={<span className="u3-bar">{seen.file && <Button icon="history" onClick={() => { patch(seen.file!.id, { binned: false }); say(`Restored “${seen.file!.name}”, also everywhere else it was used`); }}>Restore it</Button>}<Button variant="quiet" icon="close" onClick={() => removeAt(sel)}>Remove the entry</Button></span>}>The entry stays in its place until the file is restored or the entry is removed.</EmptyState>
  ) : (
    <>
      <div className="u3-box" onDblClick={() => entry && (entry.type === "canvas" ? edit(entry.id) : open(entry.id))}><Pic seen={seen} mode={mode} overlay={over} label /></div>
      <span className="u3-caption"><AppIcon glyph={TYPES[entry!.type].glyph} color={TYPES[entry!.type].color} size={20} />{entry!.name}{seen.frame && <> · {seen.frame.name === "Default frame" ? describe(prog!.frame!) : seen.frame.name} <small>({SOURCE[seen.source]})</small></>}{entry!.internalOf && <Badge icon="lock">internal</Badge>}</span>
      <span className="u3-stageacts">{entry!.type === "canvas" ? <Button size="sm" icon="edit" onClick={() => edit(entry!.id)}>Edit here</Button> : entry!.type === "photo" && <Button size="sm" icon="brush" title="A canvas on this photo: draw on it, give it a look, frame it" onClick={() => say("Makes a canvas with this photo as its base, as an internal file of the shot, and opens it here")}>Draw or frame</Button>}</span>
    </>
  );
  function removeAt(p: Pick) { if (p.list === "prog") setProg({ ...prog!, items: prog!.items.filter((_, i) => i !== p.i) }); else patch(cur, { content: content.filter((_, i) => i !== p.i) }); setPick(null); }

  // Side panel, first tab: the file of this window.
  const shotsHere = file.type === "set" ? files.filter((f) => f.type === "shot" && !f.binned && f.props.set === cur) : [];
  const setsHere = file.type === "location" ? files.filter((f) => f.type === "set" && !f.binned && (f.props.locations ?? []).includes(cur)) : [];
  const role = (f: FileRec) => (prog?.overlay?.file === f.id ? "The progression's overlay" : [prog?.items.some((i) => i.file === f.id) && `${prog!.items.filter((i) => i.file === f.id).length} pictures of the progression`, content.includes(f.id) && "in the content"].filter(Boolean).join(", ") || "Not used any more");
  const fileTab = (
    <>
      <header className="u3-head">
        <span className="u3-head__art">{thumb ? <Pic seen={see(thumb, map, docs, prog?.items[0] ? prog.frame : null)} /> : <AppIcon glyph={type.glyph} color={type.color} size={48} />}</span>
        <TextInput value={file.name} aria-label="Name" onInput={(e) => patch(cur, { name: (e.target as HTMLInputElement).value })} />
        <span className="u3-head__type"><AppIcon glyph={type.glyph} color={type.color} size={20} />{type.label}<small>{thumb ? (prog?.items[0] ? " · thumbnail: first picture of the progression" : " · thumbnail: first picture of the content") : ""}</small></span>
      </header>
      <PropertyList key={cur}>
        <FileProps file={file} files={files} onProp={(k, v) => setProp(cur, k, v)} onPos={(pos) => patch(cur, { pos })} onOpen={open} />
        {file.type === "set" && <PropertySection title={`Shots that play here · ${shotsHere.length}`} icon="slate">{shotsHere.length ? <div className="u3-chips u3-chips--pad">{shotsHere.map((f) => <FileChip key={f.id} file={f} onOpen={open} />)}</div> : <p className="u3-note">No shot names this set yet. A shot's Set property points here.</p>}</PropertySection>}
        {file.type === "location" && <PropertySection title={`Sets filmed here · ${setsHere.length}`} icon="home">{setsHere.length ? <div className="u3-chips u3-chips--pad">{setsHere.map((f) => <FileChip key={f.id} file={f} onOpen={open} />)}</div> : <p className="u3-note">No set names this location yet. A set's Locations property points here.</p>}</PropertySection>}
        {shot && internal.length > 0 && (
          <PropertySection title={`Internal files · ${internal.length}`} icon="lock">
            <ul className="u3-internal">{internal.map((f) => (
              <li key={f.id}><AppIcon glyph="brush" color={2} size={20} /><span className="u3-internal__name">{f.name}<small>{role(f)}</small></span>
                <Button size="sm" variant="quiet" icon="edit" label={`Edit ${f.name} here`} title="Edit here" onClick={() => edit(f.id)} />
                <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "release", label: "Make it a project file…", icon: "external" }, { id: "delete", label: "Delete", icon: "trash", danger: true, disabled: role(f) !== "Not used any more" }]} onSelect={(x) => (x === "release" ? setRelease(f.id) : setFiles(files.filter((y) => y.id !== f.id)))} />
              </li>
            ))}</ul>
            <p className="u3-note">Made inside this shot. Not in the file browser or in search; duplicated and deleted with the shot.</p>
          </PropertySection>
        )}
        {usedIn(cur).length > 0 && <PropertySection title={`Used in · ${usedIn(cur).length}`} icon="link" defaultOpen={false}><div className="u3-chips u3-chips--pad">{usedIn(cur).map((f) => <FileChip key={f.id} file={f} onOpen={open} />)}</div></PropertySection>}
        <PropertySection title="System" icon="info" defaultOpen={false}><PropertyRow label="Created" value={file.created} /><PropertyRow label="Created by" value={file.by} /></PropertySection>
      </PropertyList>
    </>
  );

  // Side panel, second tab: the inspector of the chosen entry's app, mounted here.
  const doc = entry ? docs[entry.id] : undefined, fr = seen?.frame && doc?.frames.find((f) => f.id === seen.frame!.id), preset = fr && PRESETS.find((p) => p.id === fr.preset);
  const elsewhere = entry ? usedIn(entry.id).filter((f) => f.id !== cur) : [];
  const setFocal = (mm: number) => setDocs({ ...docs, [entry!.id]: { ...doc!, frames: doc!.frames.map((f) => (f.id === fr!.id ? { ...f, focal: mm, name: /^\d+ mm$/.test(f.name) ? `${mm} mm` : f.name } : f)) } });
  const entryTab = !entry ? <EmptyState icon="info" title="Nothing chosen">Click a picture in the content or the progression.</EmptyState> : (
    <>
      <header className="u3-head">
        <span className="u3-head__art"><Pic seen={seen!} /></span>
        <strong>{entry.name}</strong>
        <span className="u3-head__type"><AppIcon glyph={TYPES[entry.type].glyph} color={TYPES[entry.type].color} size={20} />{TYPES[entry.type].label}<span style={{ flex: 1 }} />{entry.type === "canvas" ? <Button size="sm" icon="edit" onClick={() => edit(entry.id)}>Edit here</Button> : <Button size="sm" variant="quiet" icon="external" onClick={() => open(entry.id)}>Open</Button>}</span>
      </header>
      {entry.internalOf ? <Banner tone="info" icon="lock" action={<Button size="sm" variant="quiet" onClick={() => setRelease(entry.id)}>Make it a project file</Button>}>An internal file of this shot.</Banner>
        : elsewhere.length > 0 && <Banner tone="neutral" icon="link">Its own file. Changes show everywhere it is used: {elsewhere.map((f) => f.name).join(", ")}.</Banner>}
      <PropertyList key={entry.id + (item ? "i" : "c") + (fr ? "f" : "")}>
        {item && prog && (
          <PropertySection title="In the progression" icon="timeline">
            <PropertyRow label="Holds">{prog.timing === "each" ? <NumberInput size="sm" value={item.hold} unit="s" min={0.5} max={60} step={0.5} onChange={(v) => setProg({ ...prog, items: prog.items.map((i) => (i.id === item.id ? { ...i, hold: v } : i)) })} /> : <span className="oc-num">{times[sel!.i].toFixed(1)} s of {prog.total} s</span>}</PropertyRow>
            {doc && doc.frames.length > 0 && <PropertyRow label="Shows"><Select size="sm" value={item.frame ?? ""} onChange={(v) => setProg({ ...prog, items: prog.items.map((i) => (i.id === item.id ? { ...i, frame: v || undefined } : i)) })} options={[{ value: "", label: "The canvas as a whole" }, ...doc.frames.map((f) => ({ value: f.id, label: `Frame ${f.name}` }))]} /></PropertyRow>}
            <PropertyRow label="Seen through" value={seen!.source === "none" ? (seen!.eq ? "No frame" : "No frame: a blank canvas has no angle of view") : SOURCE[seen!.source]} />
          </PropertySection>
        )}
        {fr && (
          <PropertySection title={`Frame · ${fr.name}`} icon="frame">
            {preset && <PropertyRow label="Preset" value={preset.name} overflow="truncate" />}
            {preset && <PropertyRow label="Focal length">{preset.primes ? <span className="u3-chipset">{preset.primes.map((mm) => <button type="button" key={mm} className={cx(fr.focal === mm && "is-on")} onClick={() => setFocal(mm)}>{mm}</button>)}</span> : <span className="u3-slide"><Slider min={preset.zoom![0]} max={preset.zoom![1]} step={1} value={fr.focal!} onChange={setFocal} /><b className="oc-num">{fr.focal} mm</b></span>}</PropertyRow>}
            <p className="u3-note">The stage follows while you change it. Moving the frame or drawing needs the canvas itself: Edit here.</p>
          </PropertySection>
        )}
        <FileProps file={entry} files={files} onProp={(k, v) => setProp(entry.id, k, v)} onPos={(pos) => patch(entry.id, { pos })} onOpen={open} />
      </PropertyList>
    </>
  );

  // The progression: a small timeline. Each picture is as wide as it holds.
  let at = 0;
  const frameMenu = prog && (
    <Popover trigger={<Button size="sm" variant={prog.frame ? "secondary" : "quiet"} icon="frame" iconAfter="chevron-down">{prog.frame ? describe(prog.frame) : "No default frame"}</Button>}>
      <div className="u3-pop">
        <Segmented label="Default frame" value={prog.frame?.kind ?? "none"} onChange={(v) => setProg({ ...prog, frame: v === "none" ? null : v === "aspect" ? { kind: "aspect", aspect: 2.39 } : { kind: "preset", preset: PRESETS[0].id, focal: 24 } })} options={[{ value: "none", label: "None" }, { value: "preset", label: "Preset" }, { value: "aspect", label: "Aspect" }]} />
        {prog.frame?.kind === "preset" && (() => { const d = prog.frame as Extract<DefFrame, { kind: "preset" }>, p = PRESETS.find((x) => x.id === d.preset)!; return (<>
          <Select size="sm" value={d.preset} onChange={(v) => { const n = PRESETS.find((x) => x.id === v)!; setProg({ ...prog, frame: { kind: "preset", preset: v, focal: n.primes?.[0] ?? n.zoom![0] } }); }} options={PRESETS.map((x) => ({ value: x.id, label: x.name }))} />
          {p.primes ? <span className="u3-chipset">{p.primes.map((mm) => <button type="button" key={mm} className={cx(d.focal === mm && "is-on")} onClick={() => setProg({ ...prog, frame: { ...d, focal: mm } })}>{mm}</button>)}</span> : <span className="u3-slide"><Slider min={p.zoom![0]} max={p.zoom![1]} step={1} value={d.focal} onChange={(mm) => setProg({ ...prog, frame: { ...d, focal: mm } })} /><b className="oc-num">{d.focal} mm</b></span>}
        </>); })()}
        {prog.frame?.kind === "aspect" && <Select size="sm" value={String(prog.frame.aspect)} onChange={(v) => setProg({ ...prog, frame: { kind: "aspect", aspect: Number(v) } })} options={ASPECTS.map(([n, a]) => ({ value: String(a), label: n }))} />}
        <p className="u3-hint">Applied, centred, to pictures that have an angle of view and no frame of their own. A picture that is one frame of a canvas keeps that frame.</p>
      </div>
    </Popover>
  );
  const progression = shot && (
    <section className="u3-sec">
      <header className="u3-sec__head">
        <Icon name="timeline" /><strong>Progression</strong>
        {prog ? <>
          <span className="u3-sec__count oc-num">{prog.items.length} pictures · {clock(total)}</span>
          <Button size="sm" variant="quiet" icon={t != null ? "pause" : "play"} label={t != null ? "Pause" : "Play the progression"} disabled={!prog.items.length} onClick={() => setT(t != null ? null : 0)} />
          <Select size="sm" value={prog.timing} onChange={(v) => setTiming(v as Prog["timing"])} options={[{ value: "each", label: "Each picture its own time" }, { value: "even", label: "One length, split evenly" }, { value: "ends", label: "One length, first and last longer" }]} />
          {prog.timing !== "each" && <NumberInput size="sm" value={prog.total} unit="s" min={1} max={300} step={0.5} style={{ width: 92 }} aria-label="Total length" onChange={(v) => setProg({ ...prog, total: v })} />}
          <span className="u3-sec__sep" />
          {frameMenu}
          {prog.overlay ? <span className="u3-inline"><Switch checked={prog.overlay.visible} onChange={(c) => setProg({ ...prog, overlay: { ...prog.overlay!, visible: c } })}>Overlay</Switch><Button size="sm" variant="quiet" icon="edit" label="Edit the overlay here" title="Edit the overlay" onClick={() => edit(prog.overlay!.file)} /></span> : <Button size="sm" variant="quiet" icon="brush" title="One drawing shown over every picture" onClick={addOverlay}>Add an overlay</Button>}
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="quiet" icon="framing" onClick={() => setGen(true)}>Generate…</Button>
          <Button size="sm" icon="plus" onClick={() => setAdding("prog")}>Add pictures</Button>
          <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "content", label: "Put its files into the content too", icon: "files" }, { id: "remove", label: "Remove the progression", icon: "trash", danger: true }]} onSelect={(x) => { if (x === "remove") { setProg(undefined); setPick(null); setT(null); } else patch(cur, { content: [...new Set([...content, ...prog.items.map((i) => i.file)])] }); }} />
        </> : <>
          <span className="u3-sec__count">None: the shot stands as one picture.</span><span style={{ flex: 1 }} />
          <Button size="sm" variant="quiet" icon="framing" onClick={() => setGen(true)}>Generate a framing series…</Button>
          <Button size="sm" icon="plus" onClick={() => setAdding("prog")}>From pictures…</Button>
        </>}
      </header>
      {prog && (prog.items.length ? (
        <div className="u3-strip u3-strip--prog">
          {prog.items.map((it, i) => {
            const s = see(it, map, docs, prog.frame), w = Math.max(44, times[i] * SCALE), from = at; at += times[i];
            return (
              <div key={it.id} data-sort role="button" tabIndex={0} className={cx("u3-item", sel?.list === "prog" && sel.i === i && "is-current", s.missing && "is-missing")} style={{ width: w, ...sortP.style(i) }} title={`${s.file?.name ?? "Missing"}${s.frame ? ` · ${s.frame.name}` : ""}`} onPointerDown={sortP.start(i)} onClick={() => choose({ list: "prog", i })} onDblClick={() => s.file?.type === "canvas" && edit(s.file.id)}>
                <span className="u3-item__art"><Pic seen={s} overlay={prog.overlay?.visible} /></span>
                <span className="u3-item__label"><b>{s.frame && s.source === "own" ? s.frame.name : s.file?.name ?? "Missing"}</b><i className="oc-num">{times[i].toFixed(1)} s</i></span>
                {i === 0 && <span className="u3-item__flag" title="The shot's thumbnail"><Icon name="star" size={10} /></span>}
                <button type="button" data-nodrag className="u3-item__x" aria-label="Remove from the progression" onClick={(e) => { e.stopPropagation(); removeAt({ list: "prog", i }); }}><Icon name="close" size={10} /></button>
                {prog.timing === "each" && <i data-nodrag className="u3-item__grip" title="Drag to change how long it holds" onPointerDown={stretch(i)} />}
                {t != null && t >= from && t < from + times[i] && <i className="u3-playhead" style={{ left: `${((t - from) / times[i]) * 100}%` }} />}
              </div>
            );
          })}
          {sortP.ghost((i) => <div className="u3-item is-current" style={{ width: "100%" }}><span className="u3-item__art"><Pic seen={see(prog.items[i], map, docs, prog.frame)} /></span></div>)}
        </div>
      ) : <p className="u3-note">An empty progression. Add pictures, or generate a framing series from one photo.</p>)}
    </section>
  );

  const contentSec = (
    <section className="u3-sec">
      <header className="u3-sec__head">
        <Icon name="files" /><strong>Content</strong><span className="u3-sec__count oc-num">{content.length} {content.length === 1 ? "file" : "files"}</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="quiet" icon="brush" title="A new canvas, made inside this file" onClick={newCanvas}>New canvas</Button>
        <Button size="sm" icon="plus" onClick={() => setAdding("content")}>Add files</Button>
      </header>
      {content.length ? (
        <div className="u3-strip">
          {content.map((id, i) => {
            const s = see({ file: id }, map, docs), f = s.file;
            return (
              <div key={id} data-sort role="button" tabIndex={0} className={cx("u3-tile", sel?.list === "content" && sel.i === i && "is-current", s.missing && "is-missing")} style={sortC.style(i)} onPointerDown={sortC.start(i)} onClick={() => choose({ list: "content", i })} onDblClick={() => f && !s.missing && (f.type === "canvas" ? edit(f.id) : open(f.id))}>
                <span className="u3-tile__art"><Pic seen={s} />{f && !s.missing && f.type !== "photo" && <span className="u3-tile__type"><AppIcon glyph={TYPES[f.type].glyph} color={TYPES[f.type].color} size={20} /></span>}{f?.internalOf && <span className="u3-tile__lock" title="Internal file of this shot"><Icon name="lock" size={10} /></span>}</span>
                <span className="u3-tile__name">{s.missing ? (f ? `${f.name} · in the bin` : "Missing file") : f!.name}</span>
                <DropdownMenu size="sm" variant="quiet" icon="more" align="end" className="u3-tile__menu" items={s.missing ? [{ id: "remove", label: "Remove the entry", icon: "close" }] : [
                  ...(f!.type === "canvas" ? [{ id: "edit", label: "Edit here", icon: "edit" as const }] : []), { id: "open", label: `Open in the ${TYPES[f!.type].app} app`, icon: "external" as const },
                  ...(shot && (f!.type === "photo" || f!.type === "canvas") ? [{ id: "prog", label: "Add to the progression", icon: "timeline" as const }] : []),
                  ...(f!.internalOf ? [{ id: "release", label: "Make it a project file…", icon: "unlock" as const }] : []), { separator: true as const }, { id: "remove", label: f!.internalOf ? "Remove and delete" : "Remove from the content", icon: "close" as const, danger: !!f!.internalOf },
                ]} onSelect={(x) => { if (x === "edit") { choose({ list: "content", i }); edit(id); } else if (x === "open") open(id); else if (x === "release") setRelease(id); else if (x === "prog") { const p = prog ?? emptyProg(); setProg({ ...p, items: [...p.items, { id: `a${Date.now()}`, file: id, hold: 1 }], total: p.total + 1 }); } else { removeAt({ list: "content", i }); if (f?.internalOf && !prog?.items.some((it) => it.file === id)) setFiles((now) => now.filter((y) => y.id !== id)); } }} />
              </div>
            );
          })}
          {sortC.ghost((i) => <div className="u3-tile is-current"><span className="u3-tile__art"><Pic seen={see({ file: content[i] }, map, docs)} /></span><span className="u3-tile__name">{map.get(content[i])?.name}</span></div>)}
        </div>
      ) : <p className="u3-note">Nothing yet. Any file of the project can be content: photos, canvases, later documents and flows.</p>}
    </section>
  );

  const lower = (
    <ResizablePanel side="bottom" key={file.type} defaultSize={shot ? 318 : 176} min={120} max={460} collapsible collapsed={low} onCollapsedChange={setLow} className="u3-lower" aria-label="Content and progression">
          {progression}
          {contentSec}
        </ResizablePanel>
  );

  const tabs = [...TABS, ...(TABS.includes(cur) ? [] : [cur])];
  return (
    <div className="u3" data-theme={theme}>
      <header className="u3-proto">
        <strong>U3</strong><span className="u3-proto__note">prototype</span>
        <span className="u3-proto__files" role="tablist" aria-label="Open file">
          {tabs.map((id) => { const f = map.get(id)!; return <button type="button" key={id} role="tab" aria-selected={cur === id} className={cx(cur === id && "is-on")} onClick={() => open(id)}><AppIcon glyph={TYPES[f.type].glyph} color={TYPES[f.type].color} size={20} />{f.name}</button>; })}
        </span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="quiet" icon={theme === "light" ? "moon" : "sun"} label="Switch theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")} />
      </header>
      <div className="oc-app u3-win">
        <Toolbar>
          <AppIcon glyph={type.glyph} color={type.color} size={24} /><strong className="u3-title">{file.name}</strong>
          {shot && file.props.scene && <Badge>Scene {file.props.scene}{file.props.no ? ` · ${file.props.no}` : ""}</Badge>}
          <ToolbarSpacer />
          {!editing && <Segmented label="View mode" value={mode} disabled={!seen?.frame} onChange={(v) => setMode(v as Mode)} options={[{ value: "outline", label: "Outline" }, { value: "mask", label: "Mask" }, { value: "crop", label: "Crop" }, { value: "full", label: "Full" }]} />}
          <DropdownMenu size="sm" variant="quiet" icon="more" align="end" items={[{ id: "dup", label: "Duplicate", icon: "copy" }, { id: "bin", label: "Move to the recycle bin…", icon: "trash", danger: true }]} onSelect={(x) => (x === "bin" ? setBinning(true) : say(`A copy of “${file.name}”${internal.length ? `, with copies of its ${internal.length} internal files` : ""}`))} />
          {!editing && <Button size="sm" variant="quiet" icon="sidebar" label={closed ? "Show the side panel" : "Hide the side panel"} selected={!closed} onClick={() => setClosed(!closed)} />}
        </Toolbar>
        {editing && editFile ? (
          <div className="u3-top u3-top--edit">
            <div className="u3-host">
              <Button size="sm" icon="arrow-left" onClick={done}>Back to {file.name}</Button>
              <span className="u3-host__crumb"><AppIcon glyph={type.glyph} color={type.color} size={20} />{file.name}<Icon name="chevron-right" size={12} /><AppIcon glyph="brush" color={2} size={20} /><strong>{editFile.name}</strong></span>
              <span className="u3-host__note">{editFile.internalOf ? <><Icon name="lock" size={12} /> Internal file of this shot</> : others.length ? <><Icon name="link" size={12} /> You are changing the file itself. Also used in: {others.map((f) => f.name).join(", ")}</> : <><Icon name="file" size={12} /> A project file, used only here</>}</span>
              <span style={{ flex: 1 }} />
              {!editFile.internalOf && others.length > 0 && <Button size="sm" variant="quiet" icon="copy" onClick={() => say(`A copy of “${editFile.name}” takes its place in this ${type.label.toLowerCase()}; the original stays as it is`)}>Edit a copy instead</Button>}
              <Button size="sm" variant="primary" icon="check" onClick={done}>Done</Button>
            </div>
            <U2Canvas key={editing} host={{ title: editFile.name, theme, blank: !docs[editing]?.base, empty: fresh.includes(editing) }} />
            {lower}
          </div>
        ) : (
          <div className="u3-top">
            <div className="u3-left"><div className={cx("oc-app__stage u3-stage", (!sel || seen?.missing) && "is-empty")}>{stage}</div>{lower}</div>
            <ResizablePanel side="right" defaultSize={340} min={280} max={640} collapsible collapsed={closed} onCollapsedChange={setClosed} className="u3-side" aria-label="Properties">
              <div className="u3-tabs"><Segmented label="Side panel" value={entry ? tab : "file"} onChange={setTab} options={[{ value: "file", label: type.label, icon: type.glyph }, ...(entry ? [{ value: "entry", label: entry.name, icon: TYPES[entry.type].glyph }] : [])]} /></div>
              {tab === "entry" && entry ? entryTab : fileTab}
            </ResizablePanel>
          </div>
        )}
        <StatusBar>{content.length} in the content{prog && <> · progression of {prog.items.length} pictures, {clock(total)}</>}{internal.length > 0 && <> · {internal.length} internal files</>}{t != null && <> · playing <strong className="oc-num">{clock(t)}</strong></>}{editing && <> · editing <strong>{editFile?.name}</strong> in place: the canvas tool is mounted here</>}</StatusBar>
      </div>
      {adding && <AddFiles title={adding === "prog" ? "Add pictures to the progression" : `Add files to the content of ${file.name}`} pictures={adding === "prog"} files={files} docs={docs} onAdd={addRefs} onClose={() => setAdding(null)} />}
      {gen && <Generator files={files} start={entry?.type === "photo" ? entry.id : undefined} has={!!prog?.items.length} onMake={generate} onClose={() => setGen(false)} />}
      {release && <Confirm fixed title={`Make “${map.get(release)!.name}” a project file?`} confirmLabel="Make it a project file" message={`It appears in the file browser and in search, and other files can use it. ${file.name} keeps pointing at it. This cannot be turned back.`} onCancel={() => setRelease(null)} onConfirm={() => { patch(release, { internalOf: undefined }); say(`“${map.get(release)!.name}” is now a file of the project`); setRelease(null); }} />}
      {binning && <Confirm fixed danger title={`Move “${file.name}” to the recycle bin?`} confirmLabel="Move to the bin" message={internal.length ? `Its ${internal.length} internal files (${internal.map((f) => f.name).join(", ")}) go with it. The files in its content stay where they are.` : "The files in its content stay where they are."} onCancel={() => setBinning(false)} onConfirm={() => { setBinning(false); say(`“${file.name}” is in the recycle bin (not done in the prototype)`); }} />}
      {toast && <Toast className="u3-toast" tone="info" onDismiss={() => setToast(null)}>{toast}</Toast>}
    </div>
  );
}
