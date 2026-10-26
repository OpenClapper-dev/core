import { useState } from "react";
import { Text, View } from "react-native";
import * as Crypto from "expo-crypto";
import { CAMERAS, computeFraming, CUSTOM_CAMERA_ID, describeRig, findFormat, SPEEDBOOSTER_PRESETS } from "@openclapper/fov-math";
import { useApp } from "../appState";
import { deleteRig, getRigs, pickRig, saveRig, useRigs } from "../rigs";
import type { Preset } from "../types";
import { Block, Button, confirm, Empty, ErrorText, FieldRow, Hint, Input, ListRow, makeStyles, num, PushScreen, SectionLabel, Seg, SideBySide, toast, Toggle, type } from "../ui";
import { OptionSheet } from "../components/OptionSheet";

export function rigMeta(p: Preset): string {
  if (!p.synced) return "Not synced yet · saved on the phone";
  const lens = `${p.lensMinMm != null && p.lensMaxMm != null ? `${p.lensMinMm}–${p.lensMaxMm} mm` : "any lens"}${p.vignetting?.length ? " · vignetting" : ""}`;
  return [describeRig(p.cameraId, p.formatId, p.sensorWidthMm, p.sensorHeightMm), p.speedboosterFactor !== 1 ? `×${p.speedboosterFactor}` : null, lens].filter(Boolean).join(" · ");
}

/** Setup → Rigs & lenses: every rig, the one in use selected; tap = edit. Picking one to shoot with is the Shoot Rig sheet. */
export function RigList() {
  const app = useApp();
  const { rigs, active } = useRigs();
  return (
    <PushScreen title="Rigs & lenses" sub={`${rigs.length} rig${rigs.length === 1 ? "" : "s"} · stored on the server`}
      footer={<Button style={{ flex: 1 }} icon="plus" label="New rig" onPress={() => app.push({ name: "rigEditor", rigId: null })} />}>
      {rigs.length === 0 && <Empty icon="camera-control" title="No rig yet" body="A rig is a camera body in a recording format, plus an optional speedbooster and lens range." />}
      {rigs.map((p) => (
        <ListRow key={p.id} icon={p.synced ? "camera-outline" : "cloud-off-outline"} title={p.id === active?.id ? `${p.name} · in use` : p.name} meta={rigMeta(p)}
          onPress={() => app.push({ name: "rigEditor", rigId: p.id })} />
      ))}
    </PushScreen>
  );
}

interface Draft {
  id: string; isNew: boolean; name: string;
  /** CUSTOM_CAMERA_ID for manual dimensions. */
  cameraId: string; formatId: string | null;
  w: string; h: string;
  sb: string; customSb: boolean;
  range: boolean; lmin: string; lmax: string;
}

const parse = (s: string) => { const v = Number(s.replace(",", ".")); return s.trim() && Number.isFinite(v) && v > 0 ? v : null; };

function draftOf(p: Preset | null): Draft {
  if (!p) {
    const f = CAMERAS[0].formats[0];
    return { id: Crypto.randomUUID(), isNew: true, name: "", cameraId: CAMERAS[0].id, formatId: f.id, w: String(f.widthMm), h: String(f.heightMm), sb: "1", customSb: false, range: false, lmin: "", lmax: "" };
  }
  return {
    id: p.id, isNew: false, name: p.name,
    cameraId: p.cameraId && findFormat(p.cameraId, p.formatId) ? p.cameraId : CUSTOM_CAMERA_ID,
    formatId: p.formatId, w: String(p.sensorWidthMm), h: String(p.sensorHeightMm),
    sb: String(p.speedboosterFactor), customSb: !SPEEDBOOSTER_PRESETS.includes(p.speedboosterFactor),
    range: p.lensMinMm != null && p.lensMaxMm != null, lmin: p.lensMinMm == null ? "" : String(p.lensMinMm), lmax: p.lensMaxMm == null ? "" : String(p.lensMaxMm),
  };
}

function autoName(x: Draft): string {
  const cam = CAMERAS.find((c) => c.id === x.cameraId);
  const f = findFormat(x.cameraId, x.formatId);
  const base = cam && f ? `${cam.name.replace("Blackmagic ", "")} ${f.name.split(" ")[0]}` : "Custom";
  const sb = parse(x.sb);
  return sb && sb !== 1 ? `${base} + ×${sb}` : base;
}

/** What is wrong with the draft, or null when it can be saved. */
function problem(d: Draft): string | null {
  if (!parse(d.w) || !parse(d.h)) return "Enter the sensor width and height in mm.";
  if (!parse(d.sb)) return "Enter the speedbooster factor, e.g. 0.71.";
  if (d.range) {
    const a = parse(d.lmin), b = parse(d.lmax);
    if (!a || !b) return "Enter the shortest and the longest focal length, or turn the lens range off.";
    if (a >= b) return "The shortest focal length must be smaller than the longest.";
  }
  return null;
}

/** Full-screen rig editor: body + format (or a custom sensor), speedbooster, optional lens range, live facts. */
export function RigEditor({ rigId }: { rigId: string | null }) {
  const s = useStyles();
  const app = useApp();
  const existing = rigId ? getRigs().rigs.find((p) => p.id === rigId) ?? null : null;
  const [d, setD] = useState<Draft>(() => draftOf(existing));
  const [sheet, setSheet] = useState<"body" | "format" | null>(null);
  const patch = (x: Partial<Draft>) => setD((cur) => ({ ...cur, ...x }));
  const cam = CAMERAS.find((c) => c.id === d.cameraId);
  const custom = d.cameraId === CUSTOM_CAMERA_ID;
  const err = problem(d);

  const pickCamera = (cameraId: string) => {
    const f = CAMERAS.find((c) => c.id === cameraId)?.formats[0];
    patch({ cameraId, formatId: f?.id ?? null, w: f ? String(f.widthMm) : d.w, h: f ? String(f.heightMm) : d.h });
  };
  const pickFormat = (formatId: string) => {
    const f = findFormat(d.cameraId, formatId);
    if (f) patch({ formatId, w: String(f.widthMm), h: String(f.heightMm) });
  };

  const w = parse(d.w), h = parse(d.h), sb = parse(d.sb);
  const facts = w && h && sb ? (() => {
    const bare = computeFraming({ sensor: { widthMm: w, heightMm: h }, speedboosterFactor: 1 }, 35);
    const withSb = computeFraming({ sensor: { widthMm: w, heightMm: h }, speedboosterFactor: sb }, 35);
    return `Crop ${bare.sensorCropFactor.toFixed(2)}${sb !== 1 ? ` · with ×${sb}: ${withSb.effectiveCropFactor.toFixed(2)}` : ""} · 35 mm → ${Math.round(withSb.fullFrameEquivalentMm)} mm FF-eq`;
  })() : null;

  const save = () => {
    if (err || !w || !h || !sb) return;
    const p: Preset = {
      id: d.id,
      name: d.name.trim() || autoName(d),
      cameraId: custom ? null : d.cameraId,
      formatId: custom ? null : d.formatId,
      sensorWidthMm: w, sensorHeightMm: h, speedboosterFactor: sb,
      lensMinMm: d.range ? parse(d.lmin) : null, lensMaxMm: d.range ? parse(d.lmax) : null,
      // Vignetting is edited in the Studio (Library › Rigs); the phone keeps what it has.
      vignetting: existing?.vignetting ?? [],
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      synced: false,
    };
    void saveRig(p, d.isNew || getRigs().activeId === p.id);
    toast(d.isNew ? `Rig “${p.name}” saved · in use` : `Rig “${p.name}” saved`);
    app.pop();
  };
  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({ title: `Delete “${existing.name}”?`, body: "Deletes the rig on this phone and on the server. Shots already taken keep their framing.", confirmLabel: "Delete rig", danger: true });
    if (ok === true) { void deleteRig(existing.id); toast("Rig deleted", "neutral"); app.pop(); }
  };

  const sbOptions = [...SPEEDBOOSTER_PRESETS.map((f) => ({ id: String(f), label: f === 1 ? "None" : `×${f}` })), { id: "custom", label: "Other" }];
  return (
    <PushScreen title={d.isNew ? "New rig" : "Edit rig"} sub={d.isNew ? undefined : existing?.name}
      footer={<View style={{ flex: 1, gap: 6 }}>
        {err && <ErrorText>{err}</ErrorText>}
        <SideBySide>
          <Button style={{ flex: 1 }} kind="secondary" label="Cancel" onPress={app.pop} />
          <Button style={{ flex: 2 }} icon="check" label="Save rig" onPress={save} disabled={!!err} />
        </SideBySide>
      </View>}>
      <Block>
        <SectionLabel>Name</SectionLabel>
        <Input value={d.name} onChangeText={(name) => patch({ name })} placeholder={autoName(d)} maxLength={80} />
        <SectionLabel>Sensor</SectionLabel>
        <Seg size="lg" block accessibilityLabel="Sensor" value={custom ? "custom" : "body"} onChange={(v) => (v === "custom" ? patch({ cameraId: CUSTOM_CAMERA_ID, formatId: null }) : pickCamera(CAMERAS[0].id))}
          options={[{ id: "body", label: "Camera body" }, { id: "custom", label: "Custom sensor" }]} />
      </Block>
      {!custom && cam ? (
        <>
          <FieldRow icon="camera-outline" label="Body" value={cam.name} onPress={() => setSheet("body")} />
          <FieldRow icon="aspect-ratio" label="Format" value={findFormat(d.cameraId, d.formatId)?.name ?? null} placeholder="Pick a format" onPress={() => setSheet("format")} />
          <Block><Hint>{d.w} × {d.h} mm active area{findFormat(d.cameraId, d.formatId)?.windowed ? " · windowed crop of the sensor" : ""}</Hint></Block>
        </>
      ) : (
        <Block>
          <SideBySide>
            <Input style={{ flex: 1 }} value={d.w} onChangeText={(x) => patch({ w: x })} placeholder="width mm" keyboardType="decimal-pad" />
            <Input style={{ flex: 1 }} value={d.h} onChangeText={(x) => patch({ h: x })} placeholder="height mm" keyboardType="decimal-pad" />
          </SideBySide>
          <Hint>The area your recording mode uses, from the camera's spec sheet.</Hint>
        </Block>
      )}
      <Block>
        <SectionLabel>Speedbooster</SectionLabel>
        <Seg size="lg" block accessibilityLabel="Speedbooster" value={d.customSb ? "custom" : String(parse(d.sb) ?? 1)}
          onChange={(v) => (v === "custom" ? patch({ customSb: true }) : patch({ sb: v, customSb: false }))} options={sbOptions} />
        {d.customSb && <Input value={d.sb} onChangeText={(x) => patch({ sb: x })} placeholder="factor, e.g. 0.71" keyboardType="decimal-pad" />}
      </Block>
      <Toggle icon="arrow-expand-horizontal" label="Lens range" meta="The lens strip then stays inside it (e.g. 18–35 for a zoom)" value={d.range} onChange={(range) => patch({ range })} />
      {d.range && (
        <Block>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Input style={{ flex: 1 }} value={d.lmin} onChangeText={(x) => patch({ lmin: x })} placeholder="shortest mm" keyboardType="decimal-pad" />
            <Text style={s.dash}>–</Text>
            <Input style={{ flex: 1 }} value={d.lmax} onChangeText={(x) => patch({ lmax: x })} placeholder="longest mm" keyboardType="decimal-pad" />
          </View>
        </Block>
      )}
      {facts && <Block><Text style={s.facts}>{facts}</Text></Block>}
      {existing && (
        <Block>
          {getRigs().activeId !== existing.id && <Button kind="secondary" icon="camera-iris" label="Shoot with this rig" onPress={() => { pickRig(existing.id); toast(`Shooting with ${existing.name}`); }} />}
          <Button kind="danger" icon="delete-outline" label="Delete rig" onPress={() => void remove()} />
        </Block>
      )}
      <OptionSheet visible={sheet === "body"} title="Camera body" options={CAMERAS.map((c) => ({ id: c.id, label: c.name, meta: `${c.formats.length} formats` }))} value={[d.cameraId]} list
        onChange={(ids) => ids[0] && pickCamera(ids[0])} onClose={() => setSheet(null)} />
      <OptionSheet visible={sheet === "format"} title="Format" sub={cam?.name} options={(cam?.formats ?? []).map((f) => ({ id: f.id, label: f.name, meta: `${f.widthMm} × ${f.heightMm} mm${f.windowed ? " · windowed" : ""}` }))} value={d.formatId ? [d.formatId] : []} list
        onChange={(ids) => ids[0] && pickFormat(ids[0])} onClose={() => setSheet(null)} />
    </PushScreen>
  );
}

const useStyles = makeStyles((c) => ({
  dash: { ...type("title", "bold"), color: c.text },
  facts: { ...type("body", "semibold"), color: c.text, ...num },
}));
