// UX workshop U5, round 2: the phone and tablet app. One app in a device frame, with one tab bar for every app that
// turns with the device. The camera is built from sections that a layout fills (a control row, a lens rail, a strip
// over the picture): real lenses, optics frame, collection mode, a folder for the next photos. Media, Shots and the
// other file lists in their touch forms; the tabs chosen per device; Setup; the gates of a first start. A prototype
// on fake data: no camera, no server, no product code. Specified in docs/rewrite/03-capture.md and 09-shells.md.
import "../u3/u3.css";
import "./u5.css";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import {
  ActionBar, AppIcon, Banner, BottomSheet, BottomTabs, Button, CameraButton, HeaderAction, Icon, List, ListRow, PropertyList, PropertyRow, PropertySection, Screen, ScreenHeader, Segmented, Shutter, Slider, Switch, TextInput, TouchButton, cx,
  type IconName,
} from "@openclapper/design";
import { AndroidDevice } from "../../kits/AndroidFrame";
import { FILES, TYPES, type FileRec, type FileType } from "../u1/data";
import { picture } from "../u1/pictures";
import U2Canvas from "../u2/Canvas";
import { PRESETS } from "../u2/model";
import { fromPreset, rect, type Fr } from "../u3/model";
import { Pic, see } from "../u3/Pic";
import { FileProps } from "../u3/Props";

type Up = "done" | "preview" | "queued" | "stuck";
interface Shot { id: string; name: string; pic: number; eq?: number; state: Up; coll?: string; folder?: string; frame?: string; taken: string; imported?: boolean }
/** The phone's real lenses as the camera reports them: the maker's name and the focal length. The last one reports no focal length. */
const LENSES: { native: string; eq?: number; seed: number }[] = [{ native: "0.5×", eq: 13, seed: 16 }, { native: "1×", eq: 24, seed: 12 }, { native: "5×", eq: 120, seed: 14 }, { native: "Macro", seed: 18 }];
const LAYOUTS = [{ id: "camera", name: "Camera", note: "Built in: shutter, lenses, torch, uploads" }, { id: "viewfinder", name: "Viewfinder", note: "Built in: plus optics frame, focal lengths, reference frame, fit, blackout" }, { id: "mine", name: "Scout, wide", note: "Yours: aspect frame 2.39:1, collection, no optics" }];
const APPS: { id: string; label: string; icon: IconName; type?: FileType; needs?: string }[] = [
  { id: "camera", label: "Camera", icon: "camera" }, { id: "media", label: "Media", icon: "image" }, { id: "shots", label: "Shots", icon: "slate", type: "shot" }, { id: "sets", label: "Sets", icon: "home", type: "set" }, { id: "locations", label: "Locations", icon: "location", type: "location" }, { id: "canvas", label: "Canvas", icon: "brush" },
  { id: "hardware", label: "Hardware", icon: "light-fixture", needs: "The Hardware extension is off in this project" }, { id: "flows", label: "Flows", icon: "route", needs: "The Flows extension is off in this project" },
];
const STATE: Record<Up, { label: string; icon: IconName }> = { done: { label: "On the server", icon: "check" }, preview: { label: "Preview sent, original waiting", icon: "cloud-upload" }, queued: { label: "Waiting to upload", icon: "clock" }, stuck: { label: "Stuck: the server refused it", icon: "warning" } };
const START: Shot[] = [
  ...FILES.filter((f) => f.type === "photo" && !f.binned).slice(0, 14).map((f): Shot => { const parent = FILES.find((c) => c.id === f.parent); return { id: f.id, name: f.name, pic: f.pic!, eq: 24, state: "done", coll: parent?.type === "collection" ? parent.id : undefined, folder: parent?.type === "collection" ? parent.parent : parent?.id, taken: f.created }; }),
  { id: "q1", name: "Photo 0145", pic: 17, eq: 24, state: "preview", taken: "2026-11-23 09:41", frame: "Pocket 6K · Sigma 18–35 · 24 mm" },
  { id: "q2", name: "Photo 0146", pic: 19, eq: 13, state: "stuck", taken: "2026-11-23 09:44" },
];
let counter = 147;

export default function U5Phone() {
  const [device, setDevice] = useState("phone");
  const [land, setLand] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [signed, setSigned] = useState<"in" | "local" | null>("in");
  const [project, setProject] = useState<string | null>("Nachtzug");
  const [offline, setOffline] = useState(false);
  const [keep, setKeep] = useState(false);
  const [wifi, setWifi] = useState(true);
  const [tabs, setTabs] = useState(["camera", "media", "shots"]);
  const [tab, setTab] = useState("camera");
  const [photos, setPhotos] = useState<Shot[]>(START);
  const [colls, setColls] = useState(FILES.filter((f) => f.type === "collection").map((f) => ({ id: f.id, name: f.name, color: f.color as number })));
  const [folders, setFolders] = useState(FILES.filter((f) => f.type === "folder" && !f.fixed).map((f) => ({ id: f.id, name: f.name })));
  const [files, setFiles] = useState<FileRec[]>(FILES);
  // Camera.
  const [layout, setLayout] = useState("viewfinder");
  const [lens, setLens] = useState(1);
  const [torch, setTorch] = useState(false);
  const [preset, setPreset] = useState(PRESETS[1].id);
  const [focal, setFocal] = useState(35);
  const [zoom, setZoom] = useState(false);
  const [black, setBlack] = useState(false);
  const [upright, setUpright] = useState(false);
  const [refMm, setRefMm] = useState(0);
  const [coll, setColl] = useState<string | null>(null);
  const [dest, setDest] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  // Personal settings of the camera and of Media.
  const [lensNames, setLensNames] = useState("native");
  const [askName, setAskName] = useState("never");
  const [mark, setMark] = useState("bar");
  const [spread, setSpread] = useState(false);
  const [view, setView] = useState("photos");
  // Navigation inside a tab, and sheets.
  const [open, setOpen] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ id: string; text: string } | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast((x) => (x === m ? null : x)), 2600); };

  const tablet = device === "tablet";
  const [w, h] = tablet ? (land ? [1024, 720] : [720, 1024]) : land ? [820, 400] : [400, 820];
  const go = (t: string) => { setTab(t); setOpen(null); setSub(null); setPicked(null); };
  const upload = (id: string) => { if (offline) return; setTimeout(() => setPhotos((p) => p.map((x) => (x.id === id && x.state === "queued" ? { ...x, state: "preview" } : x))), 1200); setTimeout(() => setPhotos((p) => p.map((x) => (x.id === id && x.state === "preview" ? { ...x, state: "done" } : x))), wifi ? 3600 : 999999); };
  const waiting = photos.filter((p) => p.state !== "done").length;
  const colorOf = (id?: string) => `var(--cat-${colls.find((c) => c.id === id)?.color ?? 1})`;

  // The camera: the live picture of the real lens in use, and the frames drawn on it with the math of workshop 02.
  const L = LENSES[lens], P = PRESETS.find((p) => p.id === preset)!, lay = LAYOUTS.find((l) => l.id === layout)!;
  const lensLabel = (l: typeof L) => (lensNames === "native" || !l.eq ? l.native : `${l.eq}`);
  const mm = P.primes ? (P.primes.includes(focal) ? focal : P.primes[0]) : Math.min(P.zoom![1], Math.max(P.zoom![0], focal));
  const optics = layout === "viewfinder", aspectOnly = layout === "mine", framed = optics || aspectOnly;
  const base = fromPreset(P, mm, 5), fr: Fr | null = optics && L.eq ? { ...base, format: upright ? [base.format![1], base.format![0]] : base.format, name: `${mm} mm` } : aspectOnly ? { id: "a", name: "2.39:1", color: 6, aspect: 2.39, cx: 0.5, cy: 0.5 } : null;
  const beyond = fr && L.eq ? (() => { const r = rect(fr, L.eq!); return r.w > 1 || r.h > 1; })() : false;
  const refFr: Fr | null = optics && L.eq && refMm ? { id: "ref", name: `Full frame ${refMm}`, color: 4, format: [36, 24], mult: 1, squeeze: 1, focal: refMm, cx: 0.5, cy: 0.5 } : null;
  const shoot = () => {
    const id = `n${counter}`, p: Shot = { id, name: `Photo ${String(counter++).padStart(4, "0")}`, pic: L.seed, eq: L.eq, state: "queued", coll: coll ?? undefined, folder: dest ?? undefined, taken: "Just now", frame: optics && fr && L.eq ? `${P.name} · ${mm} mm${upright ? " · upright" : ""}` : undefined };
    setPhotos((now) => [...now, p]); setFlash(true); setTimeout(() => setFlash(false), 140); upload(id);
  };
  /** Collection mode is a switch: on starts a new collection named by the pattern, off ends it. A name is asked for only if the person set that. */
  const toggleColl = () => {
    if (coll) { const c = colls.find((x) => x.id === coll)!, count = photos.filter((p) => p.coll === coll).length; setColl(null); if (askName === "end" && count) setNaming({ id: c.id, text: c.name }); else say(count ? `${c.name}: ${count} photos` : `${c.name} stayed empty`); return; }
    const id = `c-n${counter++}`, name = `Collection ${colls.length + 1}`;
    setColls([...colls, { id, name, color: (colls.length % 8) + 1 }]); setColl(id);
    if (askName === "start") setNaming({ id, text: name });
  };
  const last = photos[photos.length - 1];
  // A layout fills three sections. Here: the built-in defaults, as the current app has them.
  const lensRail = (
    <div className="oc-cam__bar oc-cam__bar--a u5-rail">
      {LENSES.map((l, i) => <CameraButton key={l.native} label={`Lens ${l.native}${l.eq ? `, ${l.eq} mm` : ""}`} pressed={i === lens} onClick={() => setLens(i)}>{lensLabel(l)}</CameraButton>)}
      {optics && L.eq && P.primes && <><i className="u5-sep" />{P.primes.map((f) => <CameraButton key={f} label={`${f} mm`} pressed={mm === f} onClick={() => setFocal(f)}>{f}</CameraButton>)}</>}
    </div>
  );
  const controlRow = (
    <div className="oc-cam__bar oc-cam__bar--b u5-row">
      <CameraButton icon={offline ? "cloud-off" : "cloud-upload"} label={`Uploads: ${waiting} waiting`} onClick={() => { go("setup"); setSub("uploads"); }}>{waiting > 0 ? waiting : undefined}</CameraButton>
      <CameraButton icon="layers" label={coll ? "Collection mode is on: press to end the collection" : "Collection mode"} pressed={!!coll} onClick={toggleColl} />
      <Shutter onClick={shoot} />
      {optics ? <CameraButton icon="user" label={refMm ? `Reference frame: full frame ${refMm} mm` : "Reference frame"} pressed={!!refMm} onClick={() => setRefMm(refMm === 0 ? 35 : refMm === 35 ? 43 : refMm === 43 ? 50 : 0)}>{refMm ? refMm : undefined}</CameraButton> : <span className="u5-gap" />}
      <CameraButton icon="flashlight" label="Torch" pressed={torch} onClick={() => setTorch(!torch)} />
      {optics ? <CameraButton icon="lens" label={`Optics preset: ${P.name}`} onClick={() => setSheet("preset")} /> : <span className="u5-gap" />}
    </div>
  );
  const camera = (
    <div className={cx("oc-cam", `oc-cam--${land ? "landscape" : "portrait"}`, "u5-cam")}>
      {land && lensRail}
      <div className="oc-cam__view">
        <div className="u3-box u5-live">{fr ? <Pic seen={{ src: picture(L.seed), eq: L.eq ?? 24, frame: fr, source: "own" }} mode={zoom ? "crop" : black ? "mask" : "outline"} others={refFr ? [refFr] : undefined} label /> : <Pic seen={{ src: picture(L.seed), source: "none" }} />}</div>
        {flash && <span className="u5-flash" />}
        <div className="u5-top">
          <CameraButton icon="camera-layout" label="Camera layout" onClick={() => setSheet("layout")}>{lay.name}</CameraButton>
          <CameraButton icon="folder" label="Where the next photos go" pressed={!!dest} onClick={() => setSheet("dest")}>{dest ? folders.find((f) => f.id === dest)?.name : undefined}</CameraButton>
          <span style={{ flex: 1 }} />
          {framed && <CameraButton icon="expand" label="Fit: enlarge the picture so the frame fills the screen" pressed={zoom} onClick={() => setZoom(!zoom)} />}
          {framed && <CameraButton icon="contrast" label="Blackout outside the frame" pressed={black} onClick={() => setBlack(!black)} />}
          {optics && <CameraButton icon="rotate" label="Frame upright" pressed={upright} onClick={() => setUpright(!upright)} />}
        </div>
        <span className="oc-cam__label u5-hud">{L.eq ? `${L.eq} mm lens` : "Macro lens"}{optics && L.eq && <> · {P.name} · {mm} mm</>}{refFr && <> · ref {refMm}</>}{coll && <b><i style={{ background: colorOf(coll) }} />{colls.find((c) => c.id === coll)?.name} · {photos.filter((p) => p.coll === coll).length}</b>}</span>
        {optics && !L.eq && <span className="u5-warn"><Icon name="warning" size={16} />This lens reports no focal length, so no optics frame can be drawn. Aspect frames and the camera work.</span>}
        {optics && L.eq && beyond && !zoom && <span className="u5-warn"><Icon name="info" size={16} />{mm} mm sees more than the {L.eq} mm lens. Take a wider lens.</span>}
        <button type="button" className="oc-cam__thumb u5-last" aria-label="Last photo" onClick={() => { go("media"); setOpen(last.id); }}><img src={picture(last.pic)} alt="" /></button>
        {optics && L.eq && P.zoom && <div className="u5-zoom"><Slider min={P.zoom[0]} max={P.zoom[1]} value={mm} onChange={setFocal} /><b>{mm} mm</b></div>}
      </div>
      {!land && lensRail}
      {controlRow}
    </div>
  );

  // Media: every photo of the project, or its folders. Collections stacked or spread, marked as in the Studio.
  const cols = tablet ? (land ? 7 : 5) : land ? 6 : 3;
  const tile = (p: Shot) => (
    <button type="button" key={p.id} className={cx("u5-tile", p.coll && `u5-tile--${mark}`, picked?.includes(p.id) && "is-on")} style={p.coll ? { "--c": colorOf(p.coll) } : undefined} onClick={() => (picked ? setPicked(picked.includes(p.id) ? picked.filter((x) => x !== p.id) : [...picked, p.id]) : setOpen(p.id))}>
      <img src={picture(p.pic)} alt={p.name} />
      {p.state !== "done" && <span className={cx("u5-up", p.state === "stuck" && "is-stuck")} title={STATE[p.state].label}><Icon name={STATE[p.state].icon} size={12} /></span>}
      {p.coll && <i className="u5-mark" />}
      {picked && <span className="u5-tick">{picked.includes(p.id) && <Icon name="check" size={12} />}</span>}
    </button>
  );
  const stack = (c: { id: string; name: string; color: number }, list: Shot[]) => list.length > 0 && <button type="button" key={c.id} className="u5-tile u5-tile--stack" style={{ "--c": `var(--cat-${c.color})` }} onClick={() => setOpen(c.id)}><img src={picture(list[0].pic)} alt={c.name} /><span className="u5-count">{list.length}</span><span className="u5-name">{c.name}</span></button>;
  const grid = (list: Shot[]) => <div className="u5-grid" style={{ "--cols": cols }}>{!spread && !picked && colls.map((c) => stack(c, list.filter((p) => p.coll === c.id)))}{list.filter((p) => spread || picked || !p.coll).slice().reverse().map(tile)}</div>;
  const shown = photos.find((p) => p.id === open), inColl = colls.find((c) => c.id === open), inFolder = folders.find((f) => f.id === open);
  const media = shown ? (
    <Screen header={<ScreenHeader title={shown.name} subtitle={STATE[shown.state].label} onBack={() => setOpen(null)} actions={<HeaderAction icon="trash" label="Move to the bin" onClick={() => { setPhotos(photos.filter((p) => p.id !== shown.id)); setOpen(null); say("In the recycle bin"); }} />} />}
      footer={<ActionBar><TouchButton icon="layers" onClick={() => setSheet("move")}>{shown.coll ? "Collection" : "Add to a collection"}</TouchButton><TouchButton variant="primary" icon="slate" onClick={() => say("Pick a shot: the photo is added to its content")}>Add to a shot</TouchButton></ActionBar>}>
      <div className="u5-pic"><img src={picture(shown.pic)} alt="" /></div>
      <div className="u5-pad"><TextInput value={shown.name} aria-label="Name" onInput={(e) => setPhotos(photos.map((p) => (p.id === shown.id ? { ...p, name: (e.target as HTMLInputElement).value } : p)))} /></div>
      {shown.state === "stuck" && <Banner tone="warning" action={<Button size="sm" variant="quiet" onClick={() => { setPhotos(photos.map((p) => (p.id === shown.id ? { ...p, state: "queued" } : p))); upload(shown.id); }}>Retry</Button>}>The server refused this photo. It stays on the phone until it is sent or discarded.</Banner>}
      <PropertyList>
        <PropertySection title="Photo facts" icon="lock">
          <PropertyRow label="Taken" value={shown.taken} /><PropertyRow label="Lens" value={shown.eq ? `${shown.eq} mm equivalent` : "Not reported"} /><PropertyRow label="Angle of view" value={shown.eq ? `${Math.round((2 * Math.atan(34.616 / (2 * shown.eq)) * 180) / Math.PI)}° × ${Math.round((2 * Math.atan(25.962 / (2 * shown.eq)) * 180) / Math.PI)}°` : "None"} /><PropertyRow label="Device" value={shown.imported ? "None (imported)" : "Pixel 9 Pro"} />
          {shown.frame && <PropertyRow label="Frame at capture" value={shown.frame} />}
        </PropertySection>
        <PropertySection title="Where it is" icon="folder"><PropertyRow label="Folder" value={folders.find((f) => f.id === shown.folder)?.name ?? "Top level of the project"} /><PropertyRow label="Collection" value={shown.coll ? colls.find((c) => c.id === shown.coll)?.name : "None"} /></PropertySection>
      </PropertyList>
    </Screen>
  ) : (
    <Screen header={<ScreenHeader title={inColl ? inColl.name : inFolder ? inFolder.name : picked ? `${picked.length} chosen` : "Media"} subtitle={inColl ? `Collection · ${photos.filter((p) => p.coll === inColl.id).length} photos` : inFolder ? "Folder" : project ?? undefined} onBack={inColl || inFolder ? () => setOpen(null) : picked ? () => setPicked(null) : undefined}
      actions={!picked && <><HeaderAction icon={spread ? "layers" : "grid"} label={spread ? "Collections as stacks" : "Collections spread out"} onClick={() => setSpread(!spread)} /><HeaderAction icon="download" label="Import from the gallery" onClick={() => { const id = `n${counter}`; setPhotos([...photos, { id, name: `Photo ${String(counter++).padStart(4, "0")}`, pic: 41, eq: 24, state: "queued", folder: dest ?? undefined, taken: "2026-10-30 16:12 (from EXIF)", imported: true }]); upload(id); say("1 picture imported: same pipeline as a capture"); }} /><HeaderAction icon="check" label="Choose several" onClick={() => setPicked([])} /></>} />}
      footer={picked ? <ActionBar><TouchButton onClick={() => setPicked(null)}>Cancel</TouchButton><TouchButton variant="primary" icon="layers" disabled={picked.length < 2} onClick={() => { const id = `c-n${counter++}`; setColls([...colls, { id, name: `Collection ${colls.length + 1}`, color: (colls.length % 8) + 1 }]); setPhotos(photos.map((p) => (picked.includes(p.id) ? { ...p, coll: id } : p))); setPicked(null); say("A collection of the chosen photos"); }}>Make a collection</TouchButton></ActionBar> : undefined}>
      {!inColl && !inFolder && !picked && <div className="u5-pad u5-bar2"><Segmented label="Show" value={view} onChange={setView} options={[{ value: "photos", label: "All photos", icon: "image" }, { value: "folders", label: "Folders", icon: "folder" }]} /></div>}
      {inColl ? <div className="u5-grid" style={{ "--cols": cols }}>{photos.filter((p) => p.coll === inColl.id).map(tile)}</div>
        : inFolder ? grid(photos.filter((p) => p.folder === inFolder.id))
          : view === "folders" && !picked ? <><List>{folders.map((f) => <ListRow key={f.id} size="touch" icon="folder" chevron meta={`${photos.filter((p) => p.folder === f.id).length} photos`} trailing={dest === f.id ? <Icon name="camera" label="New photos go here" /> : undefined} onClick={() => setOpen(f.id)}>{f.name}</ListRow>)}</List><p className="u5-note">At the top level of the project</p>{grid(photos.filter((p) => !p.folder))}</>
            : grid(photos)}
    </Screen>
  );

  // Shots, sets and locations: a list, and the file's touch form.
  const map = new Map(files.map((f) => [f.id, f]));
  const filesOf = (t: FileType) => { const app = APPS.find((a) => a.type === t)!, file = open ? map.get(open) : undefined; return file ? (
    <Screen header={<ScreenHeader title={file.name} subtitle={TYPES[file.type].label} onBack={() => setOpen(null)} />} footer={<ActionBar><TouchButton icon="image" onClick={() => say("Pick photos or canvases from Media: they are added to the content")}>Add to the content</TouchButton>{t === "shot" && <TouchButton variant="primary" icon="play" onClick={() => say("Plays the shot's progression")}>Play</TouchButton>}</ActionBar>}>
      <div className="u5-strip">{(file.content ?? []).length ? file.content!.map((id) => <span key={id} className="u3-pickrow__art u5-strip__art"><Pic seen={see({ file: id }, map)} /></span>) : <span className="u5-empty">Nothing in the content yet.</span>}</div>
      <PropertyList><FileProps file={file} files={files} onProp={(k, v) => setFiles(files.map((f) => (f.id === file.id ? { ...f, props: { ...f.props, [k]: v } } : f)))} onPos={(pos) => setFiles(files.map((f) => (f.id === file.id ? { ...f, pos } : f)))} onOpen={(id) => { const f = map.get(id)!; const a = APPS.find((x) => x.type === f.type); if (a && tabs.includes(a.id)) { setTab(a.id); setOpen(id); } else say(`“${f.name}”: ${TYPES[f.type].plural} is not a tab on this device`); }} /></PropertyList>
    </Screen>
  ) : (
    <Screen header={<ScreenHeader title={app.label} subtitle={project ?? undefined} actions={<HeaderAction icon="plus" label={`New ${TYPES[t].label.toLowerCase()}`} onClick={() => say(`A new ${TYPES[t].label.toLowerCase()}, named by the project's pattern`)} />} />}>
      <List>{files.filter((f) => f.type === t && !f.binned).map((f) => { const first = (f.content ?? []).map((id) => map.get(id)).find((c) => c?.pic != null); return <ListRow key={f.id} size="touch" chevron leading={first ? <img className="u5-mini" src={picture(first.pic!)} alt="" /> : <AppIcon glyph={TYPES[t].glyph} color={TYPES[t].color} size={32} />} meta={t === "shot" ? [f.props.scene && `Sc. ${f.props.scene}`, f.props.size].filter(Boolean).join(" · ") : t === "location" ? String(f.props.address ?? "") : [f.props.intext, f.props.daynight].filter(Boolean).join(" · ")} onClick={() => setOpen(f.id)}>{f.name}</ListRow>; })}</List>
    </Screen>
  ); };

  // Setup: always reachable; holds project, account, this device, tabs, camera, appearance, offline and uploads.
  const row = (id: string, icon: IconName, label: string, meta?: ComponentChildren) => <ListRow key={id} size="touch" icon={icon} chevron meta={meta} onClick={() => setSub(id)}>{label}</ListRow>;
  const move = (i: number, d: number) => { const t = [...tabs]; [t[i], t[i + d]] = [t[i + d], t[i]]; setTabs(t); };
  const setup = sub === "tabs" ? (
    <Screen header={<ScreenHeader title="Tabs on this device" subtitle="Stored with the device, not with the account" onBack={() => setSub(null)} />}>
      <List>
        {tabs.map((id, i) => { const a = APPS.find((x) => x.id === id)!; return <ListRow key={id} size="touch" icon={a.icon} trailing={<span className="u5-acts"><HeaderAction icon="arrow-up" label={`${a.label} earlier`} onClick={() => i > 0 && move(i, -1)} /><HeaderAction icon="arrow-down" label={`${a.label} later`} onClick={() => i < tabs.length - 1 && move(i, 1)} /><Switch checked onChange={() => setTabs(tabs.filter((x) => x !== id))} aria-label={`${a.label} is a tab`} /></span>}>{a.label}</ListRow>; })}
        <ListRow size="touch" icon="settings" meta="Always there: tabs are chosen here" trailing={<Icon name="lock" />}>Setup</ListRow>
      </List>
      <p className="u5-note">Not a tab on this device</p>
      <List>{APPS.filter((a) => !tabs.includes(a.id)).map((a) => <ListRow key={a.id} size="touch" icon={a.icon} disabled={!!a.needs} meta={a.needs} trailing={!a.needs && <Switch checked={false} onChange={() => setTabs([...tabs, a.id])} aria-label={`${a.label} is a tab`} />}>{a.label}</ListRow>)}</List>
      <p className="u5-note">Any app with a touch form can be a tab, on a phone as on a tablet. The tab bar is the same in every app and turns with the device.</p>
    </Screen>
  ) : sub === "camera" ? (
    <Screen padded header={<ScreenHeader title="Camera" subtitle="Your preferences, for every layout" onBack={() => setSub(null)} />}>
      <p className="u5-label">Lens names</p>
      <Segmented label="Lens names" value={lensNames} onChange={setLensNames} options={[{ value: "native", label: "As the phone calls them (0.5×, 1×, 5×)" }, { value: "mm", label: "Focal length (13, 24, 120)" }]} />
      <p className="u5-note u5-note--in">The focal length is the full-frame equivalent the camera reports for the lens.</p>
      <p className="u5-label">A collection's name</p>
      <Segmented label="Collection name" value={askName} onChange={setAskName} options={[{ value: "never", label: "By the pattern" }, { value: "start", label: "Ask when it starts" }, { value: "end", label: "Ask when it ends" }]} />
      <p className="u5-note u5-note--in">Collection mode is a switch: on starts a new collection, off ends it. By the pattern it is named "Collection 3" without a question.</p>
    </Screen>
  ) : sub === "look" ? (
    <Screen padded header={<ScreenHeader title="Appearance" onBack={() => setSub(null)} />}>
      <p className="u5-label">How a photo shows its collection</p>
      <Segmented label="Collection mark" value={mark} onChange={setMark} options={[{ value: "bar", label: "Bar below" }, { value: "barleft", label: "Bar left" }, { value: "dot", label: "Dot" }, { value: "frame", label: "Frame" }]} />
      <p className="u5-note u5-note--in">The same preference as in the Studio; it follows your account. Seen in Media when collections are spread out.</p>
      <Switch checked={theme === "dark"} onChange={(c) => setTheme(c ? "dark" : "light")}>Dark theme</Switch>
    </Screen>
  ) : sub === "uploads" ? (
    <Screen header={<ScreenHeader title="Uploads" subtitle={offline ? "Offline mode: nothing is sent" : `${waiting} waiting`} onBack={() => setSub(null)} />}>
      <div className="u5-pad"><Switch checked={wifi} onChange={setWifi}>Originals on Wi-Fi only</Switch></div>
      <List>{photos.filter((p) => p.state !== "done").map((p) => <ListRow key={p.id} size="touch" leading={<img className="u5-mini" src={picture(p.pic)} alt="" />} meta={STATE[p.state].label} trailing={p.state === "stuck" ? <span className="u5-acts"><Button size="sm" onClick={() => { setPhotos(photos.map((x) => (x.id === p.id ? { ...x, state: "queued" } : x))); upload(p.id); }}>Retry</Button><Button size="sm" variant="quiet" onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}>Discard</Button></span> : <Icon name={STATE[p.state].icon} />}>{p.name}</ListRow>)}</List>
      {!waiting && <p className="u5-note">Everything is on the server.</p>}
      <p className="u5-note">A photo is stored on the phone first and is never deleted because the server refused it. Thumbnail and preview go first, the original after; the phone removes its copy of an original once the server has it.</p>
    </Screen>
  ) : sub === "device" ? (
    <Screen header={<ScreenHeader title="This device" subtitle="Registered by itself, kept current" onBack={() => setSub(null)} />}>
      <PropertyList>
        <PropertySection title="Device" icon="mobile"><PropertyRow label="Name" value={tablet ? "Pixel Tablet" : "Pixel 9 Pro"} /><PropertyRow label="Model" value={tablet ? "Google Pixel Tablet" : "Google Pixel 9 Pro"} /><PropertyRow label="Screen" value={tablet ? "2560 × 1600" : "1280 × 2856"} /><PropertyRow label="Belongs to" value="Ada's account" /></PropertySection>
        <PropertySection title="Real lenses, as the camera reports them" icon="lens">{LENSES.map((l) => <PropertyRow key={l.native} label={l.native} value={l.eq ? `${l.eq} mm · ${Math.round((2 * Math.atan(34.616 / (2 * l.eq)) * 180) / Math.PI)}° wide` : "No focal length reported: no optics frame"} />)}</PropertySection>
      </PropertyList>
      <p className="u5-note">No digital zoom: every photo is the full picture of one real lens.</p>
    </Screen>
  ) : sub === "offline" ? (
    <Screen padded header={<ScreenHeader title="Offline" onBack={() => setSub(null)} />}>
      <Switch checked={offline} onChange={setOffline}>Offline mode: no requests at all</Switch>
      <p className="u5-note u5-note--in">Photos taken offline wait in the queue.</p>
      <Switch checked={keep} onChange={setKeep}>Keep “{project ?? "the project"}” on this device</Switch>
      <p className="u5-note u5-note--in">{keep ? "Kept: previews and renders, 212 MB. Originals stay on the server." : "Its previews and renders are stored here, so it can be looked at without a connection."}</p>
    </Screen>
  ) : sub === "project" ? (
    <Screen header={<ScreenHeader title="Project" onBack={() => setSub(null)} />}>
      <List>{["Nachtzug", "Hafenfilm", "Werbespot Mai"].map((p) => <ListRow key={p} size="touch" icon="film" selected={project === p} onClick={() => { setProject(p); setSub(null); }}>{p}</ListRow>)}<ListRow size="touch" icon="plus" meta="Also works offline" onClick={() => { setProject("New project"); setSub(null); }}>New project</ListRow></List>
    </Screen>
  ) : sub === "account" ? (
    <Screen padded header={<ScreenHeader title="Account" onBack={() => setSub(null)} />}>
      {signed === "in" ? <><p>Signed in as <strong>Ada</strong>.</p><TouchButton block onClick={() => { setSigned(null); setSub(null); }}>Sign out</TouchButton></> : <><p>Not signed in. Photos stay on this {device}.</p><TouchButton block variant="primary" onClick={() => setSigned("in")}>Sign in</TouchButton></>}
    </Screen>
  ) : (
    <Screen header={<ScreenHeader title="Setup" />}>
      <List>
        {row("project", "film", "Project", project ?? "None chosen")}{row("account", "user", "Account", signed === "in" ? "Ada" : "Not signed in")}{row("device", "mobile", "This device", tablet ? "Pixel Tablet" : "Pixel 9 Pro")}{row("tabs", "apps", "Tabs on this device", `${tabs.length + 1} tabs`)}{row("camera", "camera", "Camera", lensNames === "native" ? "Lenses by the phone's names" : "Lenses by focal length")}{row("look", "palette", "Appearance", theme === "dark" ? "Dark" : "Light")}{row("offline", "cloud-off", "Offline", offline ? "Offline mode is on" : keep ? "Project kept on the device" : "Off")}{row("uploads", "cloud-upload", "Uploads", waiting ? `${waiting} waiting` : "All sent")}
      </List>
    </Screen>
  );

  // Gates: sign in (or continue without), and a project for the apps that work inside one. Setup is always reachable.
  const projects = <List>{["Nachtzug", "Hafenfilm", "Werbespot Mai"].map((p) => <ListRow key={p} size="touch" icon="film" chevron onClick={() => setProject(p)}>{p}</ListRow>)}<ListRow size="touch" icon="plus" meta="Also works offline" onClick={() => setProject("New project")}>New project</ListRow></List>;
  const typed = APPS.find((a) => a.id === tab)?.type;
  const screen = !project && tab !== "setup" ? <Screen header={<ScreenHeader title={APPS.find((a) => a.id === tab)?.label ?? ""} />}><div className="u5-gate"><Icon name="film" size={24} /><h2>Choose a project</h2><p>{APPS.find((a) => a.id === tab)?.label} works inside a project.</p></div>{projects}</Screen>
    : tab === "camera" ? camera : tab === "media" ? media : tab === "setup" ? setup : tab === "canvas" ? <U2Canvas host={{ title: "Canvas 02", theme }} /> : typed ? filesOf(typed) : <Screen header={<ScreenHeader title={tab} />} />;
  // One tab bar for every app: under the screen held upright, at its right edge held in landscape.
  const bar = <BottomTabs side={land} value={tab} onChange={go} tabs={[...tabs.map((id) => { const a = APPS.find((x) => x.id === id)!; return { id, label: a.label, icon: a.icon }; }), { id: "setup", label: "Setup", icon: "settings" }]} />;

  return (
    <div className="u3 u5" data-theme={theme}>
      <header className="u3-proto">
        <strong>U5</strong><span className="u3-proto__note">prototype</span>
        <label>Device <Segmented label="Device" value={device} onChange={setDevice} options={[{ value: "phone", label: "Phone" }, { value: "tablet", label: "Tablet" }]} /></label>
        <label>Held <Segmented label="Held" value={land ? "land" : "port"} onChange={(v) => setLand(v === "land")} options={[{ value: "port", label: "Upright" }, { value: "land", label: "Landscape" }]} /></label>
        <Button size="sm" variant="quiet" icon="refresh" onClick={() => { setSigned(null); setProject(null); setTab("camera"); setSub(null); setOpen(null); }}>First start</Button>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="quiet" icon={theme === "light" ? "moon" : "sun"} label="Switch theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")} />
      </header>
      <div className="u5-desk">
        <AndroidDevice width={w + 16} height={h + 80} dark={theme === "dark"}><div className={cx("u5-fill", land && "u5-fill--land")}>
          {!signed ? (
            <Screen padded><div className="u5-gate"><AppIcon glyph="slate" color={1} size={48} /><h2>OpenClapper</h2><p>Sign in to send your photos to your projects.</p><TouchButton block variant="primary" onClick={() => setSigned("in")}>Sign in</TouchButton><TouchButton block onClick={() => setSigned("local")}>Continue without an account</TouchButton><small>Without an account, photos stay on this {device}.</small></div></Screen>
          ) : <><div className="u5-app">{screen}</div>{bar}</>}
          {sheet === "layout" && <BottomSheet title="Camera layout" onClose={() => setSheet(null)}><List>{LAYOUTS.map((l) => <ListRow key={l.id} size="touch" icon="camera-layout" selected={layout === l.id} meta={l.note} onClick={() => { setLayout(l.id); setSheet(null); }}>{l.name}</ListRow>)}</List><p className="u5-note">A layout says which controls sit in which section: the control row, the lens rail, the strip over the picture. Layouts are made in the Studio and belong to your account.</p></BottomSheet>}
          {sheet === "preset" && <BottomSheet title="Optics preset" onClose={() => setSheet(null)}><List>{PRESETS.map((p) => <ListRow key={p.id} size="touch" icon="lens" selected={preset === p.id} meta={p.primes ? `Primes: ${p.primes.join(", ")} mm` : `Zoom ${p.zoom![0]}–${p.zoom![1]} mm`} onClick={() => { setPreset(p.id); setFocal(p.primes?.[0] ?? p.zoom![0]); setSheet(null); }}>{p.name}</ListRow>)}</List></BottomSheet>}
          {sheet === "dest" && <BottomSheet title="Where the next photos go" onClose={() => setSheet(null)}><List><ListRow size="touch" icon="film" selected={!dest} meta="Sort them later" onClick={() => { setDest(null); setSheet(null); }}>Top level of the project</ListRow>{folders.map((f) => <ListRow key={f.id} size="touch" icon="folder" selected={dest === f.id} meta={`${photos.filter((p) => p.folder === f.id).length} photos`} onClick={() => { setDest(f.id); setSheet(null); }}>{f.name}</ListRow>)}<ListRow size="touch" icon="folder-plus" onClick={() => { const id = `f-n${counter++}`; setFolders([...folders, { id, name: `Folder ${folders.length + 1}` }]); setDest(id); setSheet(null); }}>A new folder</ListRow></List></BottomSheet>}
          {sheet === "move" && shown && <BottomSheet title="Collection" onClose={() => setSheet(null)}><List>{shown.coll && <ListRow size="touch" icon="close" onClick={() => { setPhotos(photos.map((p) => (p.id === shown.id ? { ...p, coll: undefined } : p))); setSheet(null); }}>Take out of its collection</ListRow>}{colls.filter((c) => c.id !== shown.coll).map((c) => <ListRow key={c.id} size="touch" leading={<i className="u5-dot" style={{ background: `var(--cat-${c.color})` }} />} onClick={() => { setPhotos(photos.map((p) => (p.id === shown.id ? { ...p, coll: c.id } : p))); setSheet(null); }}>{c.name}</ListRow>)}</List></BottomSheet>}
          {naming && <BottomSheet title="Name of the collection" onClose={() => setNaming(null)}><div className="u5-pad u5-namer"><TextInput value={naming.text} aria-label="Name of the collection" onInput={(e) => setNaming({ ...naming, text: (e.target as HTMLInputElement).value })} /><TouchButton variant="primary" onClick={() => { setColls(colls.map((c) => (c.id === naming.id ? { ...c, name: naming.text || c.name } : c))); setNaming(null); }}>Done</TouchButton></div></BottomSheet>}
          {toast && <span className="u5-toast">{toast}</span>}
        </div></AndroidDevice>
      </div>
    </div>
  );
}
