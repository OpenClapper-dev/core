import { useEffect, useRef, useState } from "preact/hooks";
import { COMPOSE_PALETTE, SKETCH_ASPECTS, type Shape } from "@fielder/vocab";
import { createShot, existingIdOf, putLocation, putSketch, type Location, type NewShotPhoto, type Shot, type ShotState } from "./api";
import { defaultStyle, DrawSurface, TOOLS, WIDTHS, type Style, type TextEdit, type Tool } from "./compose/DrawSurface";
import { renderSketch } from "./compose/render";
import { bind, useKeys } from "./keys";
import { getSettings } from "./settings";
import { Button, Chip, Combobox, cx, Field, Icon, IconButton, Input, MarkdownField, Modal, Seg, toast } from "@fielder/ui";

/**
 * New shot without the camera (issue #27): upload images (one shot as a sequence, or one shot per
 * image) or draw a sketch. The images go up like a phone upload (photos with source "upload" /
 * "drawn", no rig, no position); a drawn shot also keeps its drawing as an editable sketch.
 */

interface Props {
  /** The active project: new shots go there. */
  projectId: string;
  locations: Location[];
  onLocations: (l: Location[]) => void;
  onClose: () => void;
  onCreated: (shots: Shot[]) => void;
}

interface Picked { id: string; file: File; url: string }
const MAX_EDGE = 2048;
const MAX_FILES = 60;
/** Phone captures are 1280 px JPEGs; uploads are scaled to at most 2048 px on the long edge and sent as JPEG. */
async function prepare(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#FFFFFF"; // transparent PNGs become white, not black, as JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("could not encode the image"))), "image/jpeg", 0.88));
  return { blob, width: w, height: h };
}

export function NewShotDialog({ projectId, locations, onLocations, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<"upload" | "draw">("upload");
  const [name, setName] = useState("");
  const [location, setLocation] = useState<string | null>(null);
  const [state, setState] = useState<ShotState>(() => getSettings().newShotState);
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [split, setSplit] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Draw
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [past, setPast] = useState<Shape[][]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [style, setStyle] = useState<Style>(() => defaultStyle(true));
  const [selected, setSelected] = useState<string | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  useEffect(() => () => { for (const f of files) URL.revokeObjectURL(f.url); }, []);

  const add = (list: FileList | File[]) => {
    const images = [...list].filter((f) => f.type.startsWith("image/"));
    if (images.length < [...list].length) toast("Only images can be added", "info");
    setFiles((cur) => [...cur, ...images.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))].slice(0, MAX_FILES));
  };
  const commit = (next: Shape[]) => { setPast((p) => [...p.slice(-99), shapes]); setShapes(next); };
  const undo = () => { const prev = past.at(-1); if (!prev) return; setShapes(prev); setPast(past.slice(0, -1)); setSelected(null); };
  const textDone = (t: TextEdit) => {
    setTextEdit(null);
    const text = t.value.trim();
    if (t.id) { commit(text ? shapes.map((s) => (s.id === t.id ? ({ ...s, text } as Shape) : s)) : shapes.filter((s) => s.id !== t.id)); return; }
    if (text) commit([...shapes, { id: crypto.randomUUID().slice(0, 12), type: "text", at: t.at, text, size: style.textSize, color: style.color, width: 0, opacity: style.opacity }]);
  };
  useKeys(bind("newshot", { undo, remove: () => { if (selected) { commit(shapes.filter((s) => s.id !== selected)); setSelected(null); } } }), mode === "draw");

  async function pickLocation(id: string | null, createName?: string) {
    if (!createName) { setLocation(id); return; }
    try {
      const created = await putLocation({ id: crypto.randomUUID(), project_id: projectId, name: createName });
      onLocations([...locations, created].sort((a, b) => a.name.localeCompare(b.name)));
      setLocation(created.id);
    } catch (err) {
      const existing = existingIdOf(err);
      if (existing) setLocation(existing); else toast(`Could not create the location: ${(err as Error).message}`, "danger");
    }
  }

  const ready = (mode === "upload" ? files.length > 0 : shapes.length > 0);
  async function create() {
    if (!ready || busy) return;
    setBusy(true);
    const now = Date.now();
    const meta = (n: number) => ({ id: crypto.randomUUID(), project_id: projectId, name: name.trim() ? (split && n > 0 ? `${name.trim()} ${n + 1}` : name.trim()) : null, location_id: location, state, description: description.trim() || null });
    try {
      const out: Shot[] = [];
      if (mode === "upload") {
        const prepared: NewShotPhoto[] = [];
        for (const [i, f] of files.entries()) prepared.push({ id: f.id, source: "upload", timestamp: new Date(now + i).toISOString(), ...(await prepare(f.file)) });
        if (split) for (const [i, p] of prepared.entries()) out.push(await createShot(meta(i), [p]));
        else out.push(await createShot(meta(0), prepared));
      } else {
        const blob = await renderSketch({ v: 1, shapes, look: null }, aspect);
        const w = 1600, h = Math.round(w / aspect);
        const m = meta(0);
        let shot = await createShot(m, [{ id: crypto.randomUUID(), blob, width: w, height: h, source: "drawn", timestamp: new Date(now).toISOString() }]);
        // The drawing stays editable as the shot's first sketch.
        try { shot = (await putSketch(crypto.randomUUID(), { shot_id: shot.id, name: "Sketch", kind: null, description: null, drawing: { v: 1, shapes, look: null }, aspect }, blob)).shot; } catch { /* the shot exists; the vector copy is a bonus */ }
        out.push(shot);
      }
      onCreated(out);
      toast(out.length > 1 ? `${out.length} shots created` : "Shot created");
    } catch (e) { toast(`Not created: ${(e as Error).message}`, "danger"); setBusy(false); }
  }

  const canvasOf = (w: number, h: number) => ({ x: 0, y: 0, w, h });
  return (
    <Modal title="New shot" width="min(1080px, 96vw)" onClose={onClose} onKeyDown={(e) => { if (e.key === "Escape" && !textEdit) { e.stopPropagation(); onClose(); } }}>
      <div class="f-modal__body newshot">
        <div class="newshot__main">
          <Seg label="Source" value={mode} onChange={setMode} options={[{ id: "upload", icon: "image-plus", label: "Upload images" }, { id: "draw", icon: "draw", label: "Draw a sketch" }]} />
          {mode === "upload" ? (
            <>
              <div class={cx("newshot__drop", drag && "is-over")} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer?.files) add(e.dataTransfer.files); }} onClick={() => input.current?.click()} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}>
                <Icon name="tray-arrow-up" size={28} /><strong>Drop images here, or click to choose</strong><span class="meta">JPEG, PNG or WebP; scaled to 2048 px. Several images make a sequence, in this order.</span>
                <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { const t = e.target as HTMLInputElement; if (t.files) add(t.files); t.value = ""; }} />
              </div>
              {files.length > 0 && (
                <>
                  <div class="newshot__files">
                    {files.map((f, i) => (
                      <div key={f.id} class="newshot__file">
                        <img src={f.url} alt="" />
                        <span class="f-strip__n">{i + 1}</span>
                        <div class="newshot__fileact">
                          <IconButton icon="chevron-left" label="Earlier" disabled={i === 0} onClick={() => setFiles((c) => { const l = [...c]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; return l; })} />
                          <IconButton icon="close" label="Remove" onClick={() => { URL.revokeObjectURL(f.url); setFiles((c) => c.filter((x) => x.id !== f.id)); }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  {files.length > 1 && <Seg label="Shots" value={split ? "split" : "one"} onChange={(v) => setSplit(v === "split")} options={[{ id: "one", label: `One shot · ${files.length} photos` }, { id: "split", label: `${files.length} shots · one each` }]} />}
                </>
              )}
            </>
          ) : (
            <>
              <div class="newshot__tools">
                <Seg label="Tool" value={tool} onChange={setTool} options={TOOLS.map((t) => ({ id: t.id, icon: t.icon, title: t.label }))} />
                <div class="swatches">{COMPOSE_PALETTE.map((c) => <button key={c} type="button" class={cx("swatch", style.color === c && "is-sel")} style={{ background: c }} title={c} aria-pressed={style.color === c} onClick={() => setStyle({ ...style, color: c })}>{style.color === c && <Icon name="check" />}</button>)}</div>
                <Seg label="Stroke width" value={WIDTHS.find((w) => w.w === style.width)?.id ?? "m"} onChange={(id) => setStyle({ ...style, width: WIDTHS.find((w) => w.id === id)!.w })} options={WIDTHS.map((w) => ({ id: w.id, label: w.label }))} />
                {(tool === "rect" || tool === "ellipse") && <Chip selected={style.fill} onClick={() => setStyle({ ...style, fill: !style.fill })}>Fill</Chip>}
                <IconButton icon="undo" label="Undo (⌘Z)" disabled={!past.length} onClick={undo} />
                <span class="grow" />
                <Seg label="Canvas" value={SKETCH_ASPECTS.find((a) => Math.abs(a.aspect - aspect) < 0.01)?.id ?? "16:9"} onChange={(id) => setAspect(SKETCH_ASPECTS.find((a) => a.id === id)!.aspect)} options={SKETCH_ASPECTS.map((a) => ({ id: a.id, label: a.id }))} />
              </div>
              <div class="newshot__canvas">
                <DrawSurface shapes={shapes} onPreview={setShapes} onCommit={commit} selected={selected} onSelect={setSelected} tool={tool} style={style}
                  canvasOf={canvasOf} aspect={aspect} maxHeight="52vh" background={() => null} sketch textEdit={textEdit} onTextEdit={setTextEdit} onTextDone={textDone} />
              </div>
            </>
          )}
        </div>
        <div class="newshot__side">
          <Field label="Name"><Input sm value={name} maxLength={120} placeholder={mode === "draw" ? "e.g. Floor plan, kitchen" : "e.g. Reference from the DP"} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
          <Field label="Location" as="div"><Combobox small icon="map-marker-outline" options={locations.map((l) => ({ value: l.id, label: l.name }))} value={location} placeholder="Search or create…" onChange={(v) => void pickLocation(v)} onCreate={(t) => void pickLocation(null, t)} /></Field>
          <Field label="Review state" as="div"><Seg label="Review state" value={state} onChange={setState} options={[{ id: "approved", label: "Approved" }, { id: "unreviewed", label: "To review" }]} /></Field>
          <Field label="Description" as="div"><MarkdownField value={description} onChange={setDescription} rows={4} placeholder="Where it comes from, what it is for…" /></Field>
          <span class="meta">The default review state is in Settings. No position and no rig: set a location (with a pin) or a position later. Tags, overlays and timelines work as for any shot.</span>
        </div>
      </div>
      <div class="f-modal__foot">
        <span class="meta">{mode === "upload" ? `${files.length} image${files.length === 1 ? "" : "s"}` : `${shapes.length} shape${shapes.length === 1 ? "" : "s"}`}</span>
        <span class="f-grow" />
        <Button kind="ghost" kbd="Esc" onClick={onClose}>Cancel</Button>
        <Button icon="plus" disabled={!ready || busy} onClick={() => void create()}>{busy ? "Creating…" : mode === "upload" && split && files.length > 1 ? `Create ${files.length} shots` : "Create shot"}</Button>
      </div>
    </Modal>
  );
}
