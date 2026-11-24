import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { allowedOptions, shownOn, valueError, valueText, type PropertyDef } from "@openclapper/model";
import { listFiles, type FileRec } from "../api";
import { currentProject } from "../projects";
import { libraryFile, useDefinitions } from "../media/library";
import { setValue, useValues } from "../media/values";
import { Block, catColor, FieldRow, Hint, ListRow, makeStyles, RADIUS, SectionLabel, Seg, Sheet, SheetList, type, useTheme } from "../ui";

/**
 * A photo's project properties on the phone (docs/features/properties.md): the same catalogue as in
 * the Studio, in its sections, each with a touch control. Choices open a sheet (a dependent choice
 * offers what its parent allows); text, numbers, dates and positions are typed. Saved at once, or
 * when the server can be reached.
 */
export function PhotoProperties({ fileId, type: fileType }: { fileId: string; type: string }) {
  const defs = useDefinitions().filter((d) => shownOn(d.def, fileType));
  const values = useValues(fileId);
  const [open, setOpen] = useState<string | null>(null);
  if (!defs.length) return null;
  const sections = [...new Set(defs.map((d) => d.def.section ?? ""))];
  const editing = defs.find((d) => d.id === open) ?? null;
  return (
    <>
      {sections.map((s) => (
        <View key={s || "none"}>
          <Block><SectionLabel>{s || "Properties"}</SectionLabel></Block>
          {defs.filter((d) => (d.def.section ?? "") === s).map((d) => (
            <Row key={d.id} id={d.id} name={d.name} def={d.def} value={values[d.id]} parent={d.def.dependsOn ? values[d.def.dependsOn.property] : undefined}
              onOpen={() => setOpen(d.id)} onChange={(v) => setValue(fileId, d.id, v)} />
          ))}
        </View>
      ))}
      {editing && <ChoiceSheet name={editing.name} def={editing.def} value={values[editing.id]} parent={editing.def.dependsOn ? values[editing.def.dependsOn.property] : undefined}
        onClose={() => setOpen(null)} onChange={(v) => setValue(fileId, editing.id, v)} />}
    </>
  );
}

const nameOf = (id: string) => libraryFile(id)?.name;

function Row({ name, def, value, parent, onOpen, onChange }: { id: string; name: string; def: PropertyDef; value: unknown; parent: unknown; onOpen: () => void; onChange: (v: unknown) => void }) {
  const s = useStyles();
  switch (def.field) {
    case "text": case "long": case "number": case "date": case "position":
      return <TypedRow name={name} def={def} value={value} onChange={onChange} />;
    case "yesno":
      return (
        <Block style={{ paddingVertical: 8 }}>
          <Text style={s.label}>{name}</Text>
          <Seg block options={[{ id: "none", label: "–" }, { id: "yes", label: "Yes" }, { id: "no", label: "No" }]} value={value === true ? "yes" : value === false ? "no" : "none"} onChange={(v) => onChange(v === "none" ? null : v === "yes")} accessibilityLabel={name} />
        </Block>
      );
    case "choice": case "multi": {
      const blocked = !!def.dependsOn && !allowedOptions(def, parent).length;
      return <FieldRow label={name} value={valueText(def, value)} placeholder={blocked ? "Choose what it depends on first" : "Not set"} onPress={blocked ? undefined : onOpen} trailing={<Swatches def={def} value={value} />} />;
    }
    case "reference":
      return <FieldRow label={name} value={valueText(def, value, nameOf)} onPress={onOpen} />;
  }
}

/** The colours of the chosen options, before the chevron. */
function Swatches({ def, value }: { def: PropertyDef; value: unknown }) {
  const { c } = useTheme();
  const ids = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const opts = ids.map((id) => def.options?.find((o) => o.id === id)).filter((o) => o && o.color !== 0);
  if (!opts.length) return null;
  return <View style={{ flexDirection: "row", gap: 3 }}>{opts.slice(0, 4).map((o) => <View key={o!.id} style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: catColor(c, o!.color) }} />)}</View>;
}

/** Text, long text, number, date and position: typed, saved when the field is left; a value that does not fit is not saved. */
function TypedRow({ name, def, value, onChange }: { name: string; def: PropertyDef; value: unknown; onChange: (v: unknown) => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const shown = def.field === "position" && value && typeof value === "object" ? `${(value as { lat: number }).lat}, ${(value as { lng: number }).lng}` : value === undefined || value === null ? "" : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const parse = (t: string): unknown => {
    const x = t.trim();
    if (!x) return null;
    if (def.field === "number") return Number(x.replace(",", "."));
    if (def.field === "position") { const m = /^(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)$/.exec(x); return m ? { lat: Number(m[1].replace(",", ".")), lng: Number(m[2].replace(",", ".")) } : x; }
    return def.field === "long" ? t : x;
  };
  const next = parse(text);
  const wrong = next !== null && valueError(def, next);
  const commit = () => { if (wrong) return; if (JSON.stringify(next) !== JSON.stringify(value ?? null)) onChange(next); };
  return (
    <Block style={{ paddingVertical: 8 }}>
      <Text style={s.label}>{name}{def.unit ? ` (${def.unit})` : ""}</Text>
      <TextInput value={text} onChangeText={setText} onEndEditing={commit} multiline={def.field === "long"} returnKeyType={def.field === "long" ? "default" : "done"}
        keyboardType={def.field === "number" ? "decimal-pad" : "default"} placeholder={def.field === "date" ? "YYYY-MM-DD" : def.field === "position" ? "Latitude, longitude" : "Not set"} placeholderTextColor={c.textDim}
        style={[s.input, def.field === "long" && { minHeight: 96, textAlignVertical: "top" }, !!wrong && { borderColor: c.danger }]} />
      {!!wrong && <Hint>{`Not saved: ${wrong}.`}</Hint>}
    </Block>
  );
}

/** A choice, several choices, or files to point at, in a sheet. */
function ChoiceSheet({ name, def, value, parent, onClose, onChange }: { name: string; def: PropertyDef; value: unknown; parent: unknown; onClose: () => void; onChange: (v: unknown) => void }) {
  const { c } = useTheme();
  const [files, setFiles] = useState<FileRec[] | null>(null);
  useEffect(() => {
    if (def.field !== "reference") return;
    const project = currentProject();
    if (!project) return;
    listFiles({ project_id: project.id }, def.targets?.length ? { type: def.targets.join(",") } : {}).then((l) => setFiles(l.filter((f) => !f.fixed && !f.internal_of && !["property", "naming"].includes(f.type))), () => setFiles([]));
  }, [def.field]);
  const list = Array.isArray(value) ? (value as string[]) : [];
  if (def.field === "reference") {
    return (
      <Sheet visible title={name} sub={def.many ? "Pick several" : "Pick one"} onClose={onClose}>
        <SheetList>
          {list.length > 0 && <ListRow icon="close" title="Clear" trailing={null} onPress={() => { onChange(null); onClose(); }} />}
          {files === null ? <Block><Hint>Loading…</Hint></Block> : !files.length ? <Block><Hint>No files to point at here, or no connection.</Hint></Block>
            : files.map((f) => <ListRow key={f.id} title={f.name} selected={list.includes(f.id)} trailing={null}
              onPress={() => { if (def.many) onChange(list.includes(f.id) ? list.filter((x) => x !== f.id) : [...list, f.id]); else { onChange([f.id]); onClose(); } }} />)}
        </SheetList>
      </Sheet>
    );
  }
  const opts = allowedOptions(def, parent);
  const dot = (color: number | string) => <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: color === 0 ? "transparent" : catColor(c, color), borderWidth: color === 0 ? 2 : 0, borderColor: c.border }} />;
  return (
    <Sheet visible title={name} sub={def.field === "multi" ? "Pick several" : undefined} onClose={onClose}>
      <SheetList>
        <ListRow icon="close" title="None" trailing={null} selected={value === undefined || value === null || (Array.isArray(value) && !value.length)} onPress={() => { onChange(null); onClose(); }} />
        {opts.map((o) => {
          const on = def.field === "multi" ? list.includes(o.id) : value === o.id;
          return <ListRow key={o.id} title={o.label} selected={on} trailing={dot(o.color)}
            onPress={() => { if (def.field === "multi") onChange(on ? list.filter((x) => x !== o.id) : [...list, o.id]); else { onChange(o.id); onClose(); } }} />;
        })}
      </SheetList>
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  label: { ...type("small", "semibold"), fontSize: 14, color: c.textDim, marginBottom: 6 },
  input: { ...type("body"), minHeight: 48, backgroundColor: c.surface, color: c.text, borderWidth: 2, borderColor: c.border, borderRadius: RADIUS.sm, paddingHorizontal: 14, paddingVertical: 8 },
}));
