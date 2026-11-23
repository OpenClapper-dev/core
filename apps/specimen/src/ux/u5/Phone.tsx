// UX workshop U5, round 1: the phone and tablet app. One app in a device frame: the camera with its layouts, real
// lenses, optics frame and collection mode; Media and Shots in their touch forms; the tabs chosen per device; Setup
// with project, account, device, offline and uploads; the gates of a first start. A prototype on fake data: no
// camera, no server, no product code. Specified in docs/rewrite/03-capture.md and 09-shells.md.
import "../u3/u3.css";
import "./u5.css";
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import {
  ActionBar, AppIcon, Banner, BottomSheet, BottomTabs, Button, CameraButton, CameraLayout, HeaderAction, Icon, List, ListRow, PropertyList, PropertyRow, PropertySection, Screen, ScreenHeader, Segmented, Shutter, Slider, Switch, TextInput, TouchButton, cx,
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
interface Shot { id: string; name: string; pic: number; eq?: number; state: Up; coll?: string; frame?: string; taken: string; imported?: boolean }
/** The phone's real lenses as the camera reports them. The last one reports no focal length: it gets no optics frame. */
const LENSES: { label: string; eq?: number; seed: number }[] = [{ label: "13", eq: 13, seed: 16 }, { label: "24", eq: 24, seed: 12 }, { label: "120", eq: 120, seed: 14 }, { label: "Macro", seed: 18 }];
const LAYOUTS = [{ id: "camera", name: "Camera", note: "Built in: shutter, lenses, torch, uploads" }, { id: "viewfinder", name: "Viewfinder", note: "Built in: plus optics frame, focal lengths, zoom to frame, reference frame" }, { id: "mine", name: "Scout, wide", note: "Yours: aspect frame 2.39:1, collection, no optics" }];
const APPS: { id: string; label: string; icon: IconName; type?: FileType; needs?: string }[] = [
  { id: "camera", label: "Camera", icon: "camera" }, { id: "media", label: "Media", icon: "image" }, { id: "shots", label: "Shots", icon: "slate", type: "shot" }, { id: "sets", label: "Sets", icon: "home", type: "set" }, { id: "locations", label: "Locations", icon: "location", type: "location" }, { id: "canvas", label: "Canvas", icon: "brush" },
  { id: "hardware", label: "Hardware", icon: "light-fixture", needs: "The Hardware extension is off in this project" }, { id: "flows", label: "Flows", icon: "route", needs: "The Flows extension is off in this project" },
];
const STATE: Record<Up, { label: string; icon: IconName }> = { done: { label: "On the server", icon: "check" }, preview: { label: "Preview sent, original waiting", icon: "cloud-upload" }, queued: { label: "Waiting to upload", icon: "clock" }, stuck: { label: "Stuck: the server refused it", icon: "warning" } };
const START: Shot[] = [
  ...FILES.filter((f) => f.type === "photo" && !f.binned).slice(0, 11).map((f): Shot => ({ id: f.id, name: f.name, pic: f.pic!, eq: 24, state: "done", coll: FILES.find((c) => c.id === f.parent)?.type === "collection" ? f.parent : undefined, taken: f.created })),
  { id: "q1", name: "Photo 0145", pic: 17, eq: 24, state: "preview", taken: "2026-11-23 09:41", frame: "Pocket 6K · Sigma 18–35 · 24 mm" },
  { id: "q2", name: "Photo 0146", pic: 19, eq: 13, state: "stuck", taken: "2026-11-23 09:44" },
];
let counter = 147;

export default function U5Phone() {
  const [device, setDevice] = useState("phone");
  const [land, setLand] = useState(true);
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
  const [files, setFiles] = useState<FileRec[]>(FILES);
  // Camera.
  const [layout, setLayout] = useState("viewfinder");
  const [lens, setLens] = useState(1);
  const [torch, setTorch] = useState(false);
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [focal, setFocal] = useState(24);
  const [zoom, setZoom] = useState(false);
  const [black, setBlack] = useState(false);
  const [upright, setUpright] = useState(false);
  const [refMm, setRefMm] = useState(0);
  const [coll, setColl] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  // Navigation inside a tab, and sheets.
  const [open, setOpen] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const say = (m: string) => { setToast(m); setTimeout(() => setToast((x) => (x === m ? null : x)), 2600); };

  const tablet = device === "tablet", wide = tablet || (land && tab === "camera" && !!signed && !!project);
  const [w, h] = tablet ? (land ? [1024, 720] : [720, 1024]) : wide ? [820, 400] : [400, 820];
  const go = (t: string) => { setTab(t); setOpen(null); setSub(null); setPicked(null); };
  const upload = (id: string) => { if (offline) return; setTimeout(() => setPhotos((p) => p.map((x) => (x.id === id && x.state === "queued" ? { ...x, state: "preview" } : x))), 1200); setTimeout(() => setPhotos((p) => p.map((x) => (x.id === id && x.state === "preview" ? { ...x, state: "done" } : x))), wifi ? 3600 : 999999); };
  const waiting = photos.filter((p) => p.state !== "done").length;

  // The camera: the live picture of the real lens in use, and the frames drawn on it with the math of workshop 02.
  const L = LENSES[lens], P = PRESETS.find((p) => p.id === preset)!, lay = LAYOUTS.find((l) => l.id === layout)!;
  const mm = P.primes ? (P.primes.includes(focal) ? focal : P.primes[0]) : Math.min(P.zoom![1], Math.max(P.zoom![0], focal));
  const optics = layout === "viewfinder", aspectOnly = layout === "mine";
  const base = fromPreset(P, mm, 5), fr: Fr | null = optics && L.eq ? { ...base, format: upright ? [base.format![1], base.format![0]] : base.format, name: `${mm} mm` } : aspectOnly ? { id: "a", name: "2.39:1", color: 6, aspect: 2.39, cx: 0.5, cy: 0.5 } : null;
  const beyond = fr && L.eq ? (() => { const r = rect(fr, L.eq!); return r.w > 1 || r.h > 1; })() : false;
  const refFr: Fr | null = optics && L.eq && refMm ? { id: "ref", name: `Full frame ${refMm}`, color: 4, format: [36, 24], mult: 1, squeeze: 1, focal: refMm, cx: 0.5, cy: 0.5 } : null;
  const shoot = () => {
    const id = `n${counter}`, p: Shot = { id, name: `Photo ${String(counter++).padStart(4, "0")}`, pic: L.seed, eq: L.eq, state: "queued", coll: coll ?? undefined, taken: "Just now", frame: optics && fr && L.eq ? `${P.name} · ${mm} mm${upright ? " · portrait" : ""}` : undefined };
    setPhotos((now) => [...now, p]); setFlash(true); setTimeout(() => setFlash(false), 140); upload(id);
  };
  const last = photos[photos.length - 1];
  const camera = (
    <CameraLayout orientation={wide ? "landscape" : "portrait"} className="u5-cam"
      barA={<>
        <CameraButton icon="bulb" label="Torch" pressed={torch} onClick={() => setTorch(!torch)} />
        {(optics || aspectOnly) && <CameraButton icon="zoom-in" label="Zoom to frame" pressed={zoom} onClick={() => setZoom(!zoom)} />}
        {(optics || aspectOnly) && <CameraButton icon="contrast" label="Blackout outside the frame" pressed={black} onClick={() => setBlack(!black)} />}
        {optics && <CameraButton icon="rotate" label="Frame upright" pressed={upright} onClick={() => setUpright(!upright)} />}
        {optics && <CameraButton icon="user" label="Reference frame" pressed={!!refMm} onClick={() => setRefMm(refMm === 0 ? 35 : refMm === 35 ? 43 : refMm === 43 ? 50 : 0)} />}
      </>}
      barB={<>
        <button type="button" className="oc-cam__thumb" aria-label="Last photo" onClick={() => { go("media"); setOpen(last.id); }}><img src={picture(last.pic)} alt="" /></button>
        <Shutter onClick={shoot} />
        <CameraButton icon="layers" label={coll ? "Collection mode is on" : "Collection mode"} pressed={!!coll} onClick={() => (coll ? setColl(null) : setSheet("coll"))} />
      </>}>
      <div className="u3-box u5-live">{fr ? <Pic seen={{ src: picture(L.seed), eq: L.eq ?? 24, frame: fr, source: "own" }} mode={zoom ? "crop" : black ? "mask" : "outline"} others={refFr ? [refFr] : undefined} label /> : <Pic seen={{ src: picture(L.seed), source: "none" }} />}</div>
      {flash && <span className="u5-flash" />}
      <div className="u5-top">
        <button type="button" className="u5-chipbtn" title="Camera layout" onClick={() => setSheet("layout")}><Icon name="camera-layout" size={16} />{lay.name}</button>
        <button type="button" className={cx("u5-chipbtn", waiting > 0 && "is-on")} title="Uploads" onClick={() => { go("setup"); setSub("uploads"); }}><Icon name={offline ? "cloud-off" : "cloud-upload"} size={16} />{waiting}</button>
      </div>
      <span className="oc-cam__label u5-hud">{L.eq ? `${L.eq} mm lens` : "Macro lens"}{optics && L.eq && <> · {P.name} · {mm} mm</>}{refFr && <> · ref {refMm}</>}</span>
      {optics && !L.eq && <span className="u5-warn"><Icon name="warning" size={16} />This lens reports no focal length, so no optics frame can be drawn. Aspect frames and the camera work.</span>}
      {optics && L.eq && beyond && !zoom && <span className="u5-warn"><Icon name="info" size={16} />{mm} mm sees more than the {L.eq} mm lens. Take a wider lens.</span>}
      {coll && <span className="oc-cam__label u5-coll"><i style={{ background: `var(--cat-${colls.find((c) => c.id === coll)?.color ?? 1})` }} />{colls.find((c) => c.id === coll)?.name} · {photos.filter((p) => p.coll === coll).length}</span>}
      <div className="u5-lenses" role="radiogroup" aria-label="Phone lens">{LENSES.map((l, i) => <button type="button" key={l.label} role="radio" aria-checked={i === lens} className={cx(i === lens && "is-on")} onClick={() => setLens(i)}>{l.label}</button>)}</div>
      {optics && L.eq && (
        <div className="u5-focal">
          <button type="button" className="u5-chipbtn" onClick={() => setSheet("preset")}><Icon name="lens" size={16} />{P.name.split(" · ")[0]}</button>
          {P.primes ? P.primes.map((f) => <button type="button" key={f} className={cx("u5-mm", mm === f && "is-on")} onClick={() => setFocal(f)}>{f}</button>) : <span className="u5-zoom"><Slider min={P.zoom![0]} max={P.zoom![1]} value={mm} onChange={setFocal} /><b>{mm} mm</b></span>}
        </div>
      )}
    </CameraLayout>
  );

  // Media.
  const cols = tablet ? (land ? 7 : 5) : 3;
  const tile = (p: Shot) => (
    <button type="button" key={p.id} className={cx("u5-tile", picked?.includes(p.id) && "is-on")} onClick={() => (picked ? setPicked(picked.includes(p.id) ? picked.filter((x) => x !== p.id) : [...picked, p.id]) : setOpen(p.id))}>
      <img src={picture(p.pic)} alt={p.name} />
      {p.state !== "done" && <span className={cx("u5-up", p.state === "stuck" && "is-stuck")} title={STATE[p.state].label}><Icon name={STATE[p.state].icon} size={12} /></span>}
      {p.coll && <i className="u5-bar" style={{ background: `var(--cat-${colls.find((c) => c.id === p.coll)?.color ?? 1})` }} />}
      {picked && <span className="u5-tick">{picked.includes(p.id) && <Icon name="check" size={12} />}</span>}
    </button>
  );
  const shown = photos.find((p) => p.id === open), inColl = open?.startsWith("c-") ? colls.find((c) => c.id === open) : undefined;
  const media = shown ? (
    <Screen header={<ScreenHeader title={shown.name} subtitle={STATE[shown.state].label} onBack={() => setOpen(shown.coll && inColl ? shown.coll : null)} actions={<HeaderAction icon="trash" label="Move to the bin" onClick={() => { setPhotos(photos.filter((p) => p.id !== shown.id)); setOpen(null); say("In the recycle bin"); }} />} />}
      footer={<ActionBar><TouchButton icon="layers" onClick={() => setSheet("move")}>{shown.coll ? "Collection" : "Add to a collection"}</TouchButton><TouchButton variant="primary" icon="slate" onClick={() => say("Pick a shot: the photo is added to its content")}>Add to a shot</TouchButton></ActionBar>}>
      <div className="u5-pic"><img src={picture(shown.pic)} alt="" /></div>
      <div className="u5-pad"><TextInput value={shown.name} aria-label="Name" onInput={(e) => setPhotos(photos.map((p) => (p.id === shown.id ? { ...p, name: (e.target as HTMLInputElement).value } : p)))} /></div>
      {shown.state === "stuck" && <Banner tone="warning" action={<Button size="sm" variant="quiet" onClick={() => { setPhotos(photos.map((p) => (p.id === shown.id ? { ...p, state: "queued" } : p))); upload(shown.id); }}>Retry</Button>}>The server refused this photo. It stays on the phone until it is sent or discarded.</Banner>}
      <PropertyList>
        <PropertySection title="Photo facts" icon="lock">
          <PropertyRow label="Taken" value={shown.taken} /><PropertyRow label="Lens" value={shown.eq ? `${shown.eq} mm equivalent` : "Not reported"} /><PropertyRow label="Angle of view" value={shown.eq ? `${Math.round((2 * Math.atan(34.616 / (2 * shown.eq)) * 180) / Math.PI)}° × ${Math.round((2 * Math.atan(25.962 / (2 * shown.eq)) * 180) / Math.PI)}°` : "None"} /><PropertyRow label="Device" value={shown.imported ? "None (imported)" : "Pixel 9 Pro"} />
          {shown.frame && <PropertyRow label="Frame at capture" value={shown.frame} />}
        </PropertySection>
        <PropertySection title="Collection" icon="layers"><PropertyRow label="In" value={shown.coll ? colls.find((c) => c.id === shown.coll)?.name : "None"} /></PropertySection>
      </PropertyList>
    </Screen>
  ) : (
    <Screen header={<ScreenHeader title={inColl ? inColl.name : picked ? `${picked.length} chosen` : "Media"} subtitle={inColl ? `Collection · ${photos.filter((p) => p.coll === inColl.id).length} photos` : project ?? undefined} onBack={inColl ? () => setOpen(null) : picked ? () => setPicked(null) : undefined} actions={!picked && <><HeaderAction icon="download" label="Import from the gallery" onClick={() => { const id = `n${counter}`; setPhotos([...photos, { id, name: `Photo ${String(counter++).padStart(4, "0")}`, pic: 41, eq: 24, state: "queued", taken: "2026-10-30 16:12 (from EXIF)", imported: true }]); upload(id); say("1 picture imported: same pipeline as a capture"); }} /><HeaderAction icon="check" label="Choose several" onClick={() => setPicked([])} /></>} />}
      footer={picked ? <ActionBar><TouchButton onClick={() => setPicked(null)}>Cancel</TouchButton><TouchButton variant="primary" icon="layers" disabled={picked.length < 2} onClick={() => { const id = `c-n${counter++}`; setColls([...colls, { id, name: `Collection ${colls.length + 1}`, color: (colls.length % 8) + 1 }]); setPhotos(photos.map((p) => (picked.includes(p.id) ? { ...p, coll: id } : p))); setPicked(null); say("A collection of the chosen photos"); }}>Make a collection</TouchButton></ActionBar> : bar()}>
      <div className="u5-grid" style={{ "--cols": cols }}>
        {!inColl && !picked && colls.map((c) => { const mine = photos.filter((p) => p.coll === c.id); return mine.length > 0 && <button type="button" key={c.id} className="u5-tile u5-tile--stack" style={{ "--c": `var(--cat-${c.color})` }} onClick={() => setOpen(c.id)}><img src={picture(mine[0].pic)} alt={c.name} /><span className="u5-count">{mine.length}</span><span className="u5-name">{c.name}</span></button>; })}
        {photos.filter((p) => (inColl ? p.coll === inColl.id : picked ? true : !p.coll)).slice().reverse().map(tile)}
      </div>
    </Screen>
  );

  // Shots, sets and locations: a list, and the file's touch form.
  function bar() { return <BottomTabs value={tab} onChange={go} tabs={[...tabs.map((id) => { const a = APPS.find((x) => x.id === id)!; return { id, label: a.label, icon: a.icon }; }), { id: "setup", label: "Setup", icon: "settings" }]} />; }
  const map = new Map(files.map((f) => [f.id, f]));
  const filesOf = (t: FileType) => { const app = APPS.find((a) => a.type === t)!, file = open ? map.get(open) : undefined; return file ? (
    <Screen header={<ScreenHeader title={file.name} subtitle={TYPES[file.type].label} onBack={() => setOpen(null)} />} footer={<ActionBar><TouchButton icon="image" onClick={() => say("Pick photos or canvases from Media: they are added to the content")}>Add to the content</TouchButton>{t === "shot" && <TouchButton variant="primary" icon="play" onClick={() => say("Plays the shot's progression")}>Play</TouchButton>}</ActionBar>}>
      <div className="u5-strip">{(file.content ?? []).length ? file.content!.map((id) => <span key={id} className="u3-pickrow__art u5-strip__art"><Pic seen={see({ file: id }, map)} /></span>) : <span className="u5-empty">Nothing in the content yet.</span>}</div>
      <PropertyList><FileProps file={file} files={files} onProp={(k, v) => setFiles(files.map((f) => (f.id === file.id ? { ...f, props: { ...f.props, [k]: v } } : f)))} onPos={(pos) => setFiles(files.map((f) => (f.id === file.id ? { ...f, pos } : f)))} onOpen={(id) => { const f = map.get(id)!; const a = APPS.find((x) => x.type === f.type); if (a && tabs.includes(a.id)) { setTab(a.id); setOpen(id); } else say(`“${f.name}”: ${TYPES[f.type].plural} is not a tab on this device`); }} /></PropertyList>
    </Screen>
  ) : (
    <Screen header={<ScreenHeader title={app.label} subtitle={project ?? undefined} actions={<HeaderAction icon="plus" label={`New ${TYPES[t].label.toLowerCase()}`} onClick={() => say(`A new ${TYPES[t].label.toLowerCase()}, named by the project's pattern`)} />} />} footer={bar()}>
      <List>{files.filter((f) => f.type === t && !f.binned).map((f) => { const first = (f.content ?? []).map((id) => map.get(id)).find((c) => c?.pic != null); return <ListRow key={f.id} size="touch" chevron leading={first ? <img className="u5-mini" src={picture(first.pic!)} alt="" /> : <AppIcon glyph={TYPES[t].glyph} color={TYPES[t].color} size={32} />} meta={t === "shot" ? [f.props.scene && `Sc. ${f.props.scene}`, f.props.size].filter(Boolean).join(" · ") : t === "location" ? String(f.props.address ?? "") : [f.props.intext, f.props.daynight].filter(Boolean).join(" · ")} onClick={() => setOpen(f.id)}>{f.name}</ListRow>; })}</List>
    </Screen>
  ); };

  // Setup: always reachable; holds project, account, this device, tabs, offline and uploads.
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
      <p className="u5-note">Any app with a touch form can be a tab, on a phone as on a tablet. A new device starts with Camera, Media, Shots and Setup.</p>
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
        <PropertySection title="Real lenses, as the camera reports them" icon="lens">{LENSES.map((l) => <PropertyRow key={l.label} label={l.eq ? `${l.eq} mm` : l.label} value={l.eq ? `${Math.round((2 * Math.atan(34.616 / (2 * l.eq)) * 180) / Math.PI)}° wide` : "No focal length reported: no optics frame"} />)}</PropertySection>
      </PropertyList>
      <p className="u5-note">No digital zoom: every photo is the full picture of one real lens.</p>
    </Screen>
  ) : sub === "offline" ? (
    <Screen padded header={<ScreenHeader title="Offline" onBack={() => setSub(null)} />}>
      <Switch checked={offline} onChange={setOffline}>Offline mode: no requests at all</Switch>
      <p className="u5-note">Photos taken offline wait in the queue.</p>
      <Switch checked={keep} onChange={setKeep}>Keep “{project ?? "the project"}” on this device</Switch>
      <p className="u5-note">{keep ? "Kept: previews and renders, 212 MB. Originals stay on the server." : "Its previews and renders are stored here, so it can be looked at without a connection."}</p>
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
    <Screen header={<ScreenHeader title="Setup" />} footer={bar()}>
      <List>
        {row("project", "film", "Project", project ?? "None chosen")}{row("account", "user", "Account", signed === "in" ? "Ada" : "Not signed in")}{row("device", "mobile", "This device", tablet ? "Pixel Tablet" : "Pixel 9 Pro")}{row("tabs", "apps", "Tabs on this device", `${tabs.length + 1} tabs`)}{row("offline", "cloud-off", "Offline", offline ? "Offline mode is on" : keep ? "Project kept on the device" : "Off")}{row("uploads", "cloud-upload", "Uploads", waiting ? `${waiting} waiting` : "All sent")}
      </List>
    </Screen>
  );

  // Gates: sign in (or continue without), and a project for the apps that work inside one. Setup is always reachable.
  const gate = !signed ? (
    <Screen padded>
      <div className="u5-gate"><AppIcon glyph="slate" color={1} size={48} /><h2>OpenClapper</h2><p>Sign in to send your photos to your projects.</p>
        <TouchButton block variant="primary" onClick={() => setSigned("in")}>Sign in</TouchButton><TouchButton block onClick={() => setSigned("local")}>Continue without an account</TouchButton><small>Without an account, photos stay on this {device}.</small></div>
    </Screen>
  ) : !project && tab !== "setup" ? (
    <Screen header={<ScreenHeader title={APPS.find((a) => a.id === tab)?.label ?? ""} />} footer={bar()}>
      <div className="u5-gate"><Icon name="film" size={24} /><h2>Choose a project</h2><p>{APPS.find((a) => a.id === tab)?.label} works inside a project.</p></div>
      <List>{["Nachtzug", "Hafenfilm", "Werbespot Mai"].map((p) => <ListRow key={p} size="touch" icon="film" chevron onClick={() => setProject(p)}>{p}</ListRow>)}<ListRow size="touch" icon="plus" meta="Also works offline" onClick={() => setProject("New project")}>New project</ListRow></List>
    </Screen>
  ) : null;
  const typed = APPS.find((a) => a.id === tab)?.type;
  const screen = gate ?? (tab === "camera" ? <div className="u5-camwrap">{camera}{!wide && bar()}{wide && <div className="u5-railtabs">{[...tabs, "setup"].filter((t) => t !== "camera").map((id) => { const a = APPS.find((x) => x.id === id) ?? { label: "Setup", icon: "settings" as IconName }; return <CameraButton key={id} icon={a.icon} label={a.label} onClick={() => go(id)} />; })}</div>}</div>
    : tab === "media" ? media : tab === "setup" ? setup : tab === "canvas" ? <div className="u5-camwrap"><U2Canvas host={{ title: "Canvas 02", theme }} />{bar()}</div> : typed ? filesOf(typed) : <Screen header={<ScreenHeader title={tab} />} footer={bar()} />);

  return (
    <div className="u3 u5" data-theme={theme}>
      <header className="u3-proto">
        <strong>U5</strong><span className="u3-proto__note">prototype</span>
        <label>Device <Segmented label="Device" value={device} onChange={setDevice} options={[{ value: "phone", label: "Phone" }, { value: "tablet", label: "Tablet" }]} /></label>
        <label>Held <Segmented label="Held" value={land ? "land" : "port"} onChange={(v) => setLand(v === "land")} options={[{ value: "land", label: "Landscape" }, { value: "port", label: "Portrait" }]} /></label>
        <Button size="sm" variant="quiet" icon="refresh" onClick={() => { setSigned(null); setProject(null); setTab("camera"); setSub(null); setOpen(null); }}>First start</Button>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="quiet" icon={theme === "light" ? "moon" : "sun"} label="Switch theme" onClick={() => setTheme(theme === "light" ? "dark" : "light")} />
      </header>
      <div className="u5-desk">
        <AndroidDevice width={w + 16} height={h + 80} dark={theme === "dark"}><div className="u5-fill">{screen}
          {sheet === "layout" && <BottomSheet title="Camera layout" onClose={() => setSheet(null)}><List>{LAYOUTS.map((l) => <ListRow key={l.id} size="touch" icon="camera-layout" selected={layout === l.id} meta={l.note} onClick={() => { setLayout(l.id); setSheet(null); }}>{l.name}</ListRow>)}</List><p className="u5-note">Layouts are made in the Studio and belong to your account.</p></BottomSheet>}
          {sheet === "preset" && <BottomSheet title="Optics preset" onClose={() => setSheet(null)}><List>{PRESETS.map((p) => <ListRow key={p.id} size="touch" icon="lens" selected={preset === p.id} meta={p.primes ? `${p.primes.join(", ")} mm` : `Zoom ${p.zoom![0]}–${p.zoom![1]} mm`} onClick={() => { setPreset(p.id); setFocal(p.primes?.[0] ?? p.zoom![0]); setSheet(null); }}>{p.name}</ListRow>)}</List></BottomSheet>}
          {sheet === "coll" && <BottomSheet title="Collection mode" onClose={() => setSheet(null)}><List><ListRow size="touch" icon="plus" meta="What you shoot now goes into it" onClick={() => { const id = `c-n${counter++}`; setColls([...colls, { id, name: `Collection ${colls.length + 1}`, color: (colls.length % 8) + 1 }]); setColl(id); setSheet(null); }}>A new collection</ListRow>{colls.map((c) => <ListRow key={c.id} size="touch" leading={<i className="u5-dot" style={{ background: `var(--cat-${c.color})` }} />} meta={`${photos.filter((p) => p.coll === c.id).length} photos`} onClick={() => { setColl(c.id); setSheet(null); }}>{c.name}</ListRow>)}</List></BottomSheet>}
          {sheet === "move" && shown && <BottomSheet title="Collection" onClose={() => setSheet(null)}><List>{shown.coll && <ListRow size="touch" icon="close" onClick={() => { setPhotos(photos.map((p) => (p.id === shown.id ? { ...p, coll: undefined } : p))); setSheet(null); }}>Take out of its collection</ListRow>}{colls.filter((c) => c.id !== shown.coll).map((c) => <ListRow key={c.id} size="touch" leading={<i className="u5-dot" style={{ background: `var(--cat-${c.color})` }} />} onClick={() => { setPhotos(photos.map((p) => (p.id === shown.id ? { ...p, coll: c.id } : p))); setSheet(null); }}>{c.name}</ListRow>)}</List></BottomSheet>}
          {toast && <span className="u5-toast">{toast}</span>}
        </div></AndroidDevice>
      </div>
    </div>
  );
}
