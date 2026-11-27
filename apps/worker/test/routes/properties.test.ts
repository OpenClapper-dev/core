/**
 * Properties (step B4, #376): a new project without any (#426), values with their rules, dependent
 * choices, references, bulk edit, search over names and values, a definition that changes, naming
 * patterns, copies and purges.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { addPhoto, api, newUser, ok, uuid, type User } from "./helpers.ts";

interface FileOut { id: string; type: string; name: string; container: string | null; body?: Record<string, unknown>; values?: Record<string, unknown> }
let u: User;
let project: string;
beforeAll(async () => { u = await newUser(); });

async function newProject(): Promise<string> {
  const id = uuid();
  await ok(api(u.token, "PUT", `/api/projects/${id}`, { name: `P ${id}` }), 201);
  return (project = id);
}
const put = (id: string, body: unknown, status: number | number[] = [200, 201]) => ok<{ file: FileOut; error: string }>(api(u.token, "PUT", `/api/files/${id}`, body), status);
const list = async (query = "") => (await ok<{ files: FileOut[] }>(api(u.token, "GET", `/api/files?project_id=${project}${query}`))).files;
const defs = async () => Object.fromEntries((await list("&type=property&body=1")).map((f) => [f.name, f]));
const shot = async (name?: string) => { const id = uuid(); await put(id, { type: "shot", project_id: project, ...(name ? { name } : {}) }, 201); return id; };
const setProps = (id: string, values: Record<string, unknown>, status: number | number[] = 200) => ok<{ values: Record<string, unknown>; error: string }>(api(u.token, "PUT", `/api/files/${id}/properties`, { values }), status);
const settings = async () => (await list("&type=folder")).find((f) => f.name === "Settings")!.id;
const defBody = (more: Record<string, unknown>) => ({ field: "text", attached: [{ type: "shot" }], order: 50, ...more });
const newDef = async (name: string, body: Record<string, unknown>) => { const id = uuid(); await put(id, { type: "property", project_id: project, name, container: await settings(), body: defBody(body) }, 201); return id; };
/** A single choice with these labels; the option ids are the labels in lower case, spaces as dashes. */
const choice = (...labels: string[]) => ({ field: "choice", options: labels.map((label, i) => ({ id: label.toLowerCase().replace(/ /g, "-"), label, color: i + 1 })) });
const SET = { field: "reference", targets: ["set"], many: false };

describe("a new project", () => {
  test("starts without properties; its Settings do not count as its files", async () => {
    await newProject();
    expect(await defs()).toEqual({});
    expect((await list("&type=settings")).length).toBeGreaterThan(0);
    const { projects } = await ok<{ projects: { id: string; file_count: number }[] }>(api(u.token, "GET", "/api/projects"));
    expect(projects.find((p) => p.id === project)!.file_count).toBe(0);
    await ok(api(u.token, "DELETE", `/api/projects/${project}`), 200);
  });

  test("a definition lives only in Settings", async () => {
    await newProject();
    expect((await put(uuid(), { type: "property", project_id: project, name: "X", body: defBody({}) }, 400)).error).toMatch(/Settings/);
  });
});

describe("values", () => {
  test("are checked against the definition, the file type and the project", async () => {
    await newProject();
    await newDef("Scene", {});
    await newDef("Shot size", choice("EWS", "WS", "MS"));
    await newDef("Kind", { ...choice("Floor plan", "Storyboard"), attached: [{ type: "canvas" }] });
    const d = await defs();
    const s = await shot("Shot A");
    const size = d["Shot size"], kind = d.Kind;
    const opts = (size.body!.options as { id: string }[]).map((o) => o.id);
    expect((await setProps(s, { [size.id]: opts[2], [d.Scene.id]: "12A" })).values).toEqual({ [size.id]: opts[2], [d.Scene.id]: "12A" });
    expect((await setProps(s, { [size.id]: "nope" }, 400)).error).toMatch(/Shot size.*one of the options/);
    expect((await setProps(s, { [kind.id]: (kind.body!.options as { id: string }[])[0].id }, 400)).error).toMatch(/not a property of shots/);
    expect((await setProps(s, { [uuid()]: "x" }, 400)).error).toMatch(/no property/);
    expect((await setProps(s, { [d.Scene.id]: "two\nlines" }, 400)).error).toMatch(/one line/);
    // null removes a value.
    expect((await setProps(s, { [d.Scene.id]: null })).values).toEqual({ [size.id]: opts[2] });
    const [got] = (await list("&type=shot&values=1"));
    expect(got.values).toEqual({ [size.id]: opts[2] });
  });

  test("a reference names live files of the project of its target types, and counts as a use", async () => {
    await newProject();
    await newDef("Set", SET);
    const d = await defs();
    const set = d.Set;
    const s = await shot();
    const other = await shot();
    expect((await setProps(s, { [set.id]: [other] }, 400)).error).toMatch(/points at set only/);
    await ok(api(u.token, "PUT", `/api/files/${set.id}`, { body: { ...set.body, targets: [] } }), 200);
    expect((await setProps(s, { [set.id]: [other] })).values[set.id]).toEqual([other]);
    const uses = await ok<{ uses: { id: string; kind: string }[] }>(api(u.token, "GET", `/api/files/${other}/uses`));
    expect(uses.uses).toEqual([expect.objectContaining({ id: s, kind: "property" })]);
    expect((await setProps(s, { [set.id]: [uuid()] }, 400)).error).toMatch(/not in this project/);
  });

  test("a dependent choice offers what its parent allows and is cleared when the parent changes", async () => {
    await newProject();
    const line = await newDef("Line", { field: "choice", options: [{ id: "u1", label: "U1", color: 1 }, { id: "u4", label: "U4", color: 2 }] });
    const station = await newDef("Station", { field: "choice", options: [{ id: "kudamm", label: "Kurfürstendamm", color: 0 }, { id: "nolle", label: "Nollendorfplatz", color: 0 }], dependsOn: { property: line, map: { u1: ["kudamm"], u4: ["nolle", "kudamm"] } } });
    const s = await shot();
    expect((await setProps(s, { [station]: "nolle" }, 400)).error).toMatch(/fits the property it depends on/);
    await setProps(s, { [line]: "u4", [station]: "nolle" });
    expect((await setProps(s, { [line]: "u1" })).values).toEqual({ [line]: "u1" });
  });

  test("bulk edit sets the same values on many files, all or none", async () => {
    await newProject();
    await newDef("Lens", {});
    const d = await defs();
    const a = await shot(), b = await shot();
    const out = await ok<{ values: Record<string, Record<string, unknown>> }>(api(u.token, "POST", "/api/properties/set", { ids: [a, b], values: { [d.Lens.id]: "35mm" } }));
    expect(out.values[a]).toEqual({ [d.Lens.id]: "35mm" });
    expect(out.values[b]).toEqual({ [d.Lens.id]: "35mm" });
    const folderId = uuid();
    await put(folderId, { type: "folder", project_id: project }, 201);
    await ok(api(u.token, "POST", "/api/properties/set", { ids: [a, folderId], values: { [d.Lens.id]: "50mm" } }), 400);
    expect((await list("&type=shot&values=1")).map((f) => f.values![d.Lens.id])).toEqual(["35mm", "35mm"]);
  });
});

describe("search", () => {
  test("looks at names and values, with case and accents folded", async () => {
    await newProject();
    await newDef("Scene", {});
    await newDef("INT / EXT", choice("INT", "EXT"));
    const d = await defs();
    const a = await shot("Über den Dächern"), b = await shot("Street");
    const ext = (d["INT / EXT"].body!.options as { id: string; label: string }[]).find((o) => o.label === "EXT")!.id;
    await setProps(b, { [d.Scene.id]: "Hafenstraße", [d["INT / EXT"].id]: ext });
    const found = async (q: string) => (await list(`&q=${encodeURIComponent(q)}`)).map((f) => f.id);
    expect(await found("uber")).toEqual([a]);
    expect(await found("HAFENSTRASSE")).toEqual([b]);
    expect(await found("hafenstra")).toEqual([b]);
    expect(await found("ext street")).toEqual([b]);
    expect(await found("ext uber")).toEqual([]);
  });
});

describe("a definition that changes", () => {
  test("keeps values of renamed options and drops those of removed ones", async () => {
    await newProject();
    await newDef("Shot size", choice("EWS", "WS", "MS"));
    const d = await defs();
    const size = d["Shot size"];
    const options = size.body!.options as { id: string; label: string; color: number }[];
    const a = await shot(), b = await shot();
    await setProps(a, { [size.id]: options[0].id });
    await setProps(b, { [size.id]: options[1].id });
    const next = options.slice(1).map((o, i) => (i === 0 ? { ...o, label: "Wide" } : o));
    await ok(api(u.token, "PUT", `/api/files/${size.id}`, { body: { ...size.body, options: next } }), 200);
    const vals = Object.fromEntries((await list("&type=shot&values=1")).map((f) => [f.id, f.values]));
    expect(vals[a]).toEqual({});
    expect(vals[b]).toEqual({ [size.id]: options[1].id });
    // Another field type: the values that do not fit go.
    await ok(api(u.token, "PUT", `/api/files/${size.id}`, { body: { field: "number", attached: [{ type: "shot" }], order: 0 } }), 200);
    expect((await list("&type=shot&values=1")).every((f) => !(size.id in f.values!))).toBe(true);
  });

  test("purged, its values and the references they kept go with it", async () => {
    await newProject();
    await newDef("Set", SET);
    const d = await defs();
    const set = d.Set;
    await ok(api(u.token, "PUT", `/api/files/${set.id}`, { body: { ...set.body, targets: [] } }), 200);
    const a = await shot(), b = await shot();
    await setProps(a, { [set.id]: [b] });
    await ok(api(u.token, "POST", "/api/files/bin", { ids: [set.id] }), 200);
    await ok(api(u.token, "POST", "/api/files/purge", { ids: [set.id] }), 200);
    expect((await ok<{ uses: unknown[] }>(api(u.token, "GET", `/api/files/${b}/uses`))).uses).toEqual([]);
    expect((await list("&type=shot&values=1")).find((f) => f.id === a)!.values).toEqual({});
  });
});

describe("names", () => {
  test("come from the type's pattern with a counter per project and type", async () => {
    await newProject();
    expect((await list("&type=shot")).length).toBe(0);
    const a = await shot(), b = await shot();
    expect((await list("&type=shot")).map((f) => f.name)).toEqual(["Shot 001", "Shot 002"]);
    await put(uuid(), { type: "naming", project_id: project, name: "Shots", container: await settings(), body: { for: "shot", pattern: "SH-{counter}", digits: 2 } }, 201);
    await shot();
    // A broken pattern is not used.
    await put(uuid(), { type: "naming", project_id: project, name: "Photos", container: await settings(), body: { for: "photo", pattern: "{nope}", digits: 2 } }, 201);
    const p = await addPhoto(u.token, project);
    expect((await list("&type=shot")).map((f) => f.name)).toEqual(["SH-03", "Shot 001", "Shot 002"]);
    expect((await list("&type=photo")).find((f) => f.id === p)!.name).toBe("Photo 0001");
    void a; void b;
  });
});

describe("a copy", () => {
  test("takes its values; a reference to a file copied along points at the copy", async () => {
    await newProject();
    await newDef("Set", SET);
    await newDef("Lens", {});
    const d = await defs();
    const set = d.Set;
    await ok(api(u.token, "PUT", `/api/files/${set.id}`, { body: { ...set.body, targets: [] } }), 200);
    const folder = uuid();
    await put(folder, { type: "folder", project_id: project, name: "Day 1" }, 201);
    const inner = uuid(), target = uuid();
    await put(inner, { type: "shot", project_id: project, container: folder }, 201);
    await put(target, { type: "shot", project_id: project, container: folder }, 201);
    await setProps(inner, { [set.id]: [target], [d.Lens.id]: "50mm" });
    const copy = uuid();
    await ok(api(u.token, "POST", `/api/files/${folder}/duplicate`, { id: copy }), 201);
    const copies = (await list(`&container=${copy}&values=1`));
    const copiedTarget = copies.find((f) => !(set.id in f.values!))!;
    const copiedInner = copies.find((f) => set.id in f.values!)!;
    expect(copiedInner.values).toEqual({ [set.id]: [copiedTarget.id], [d.Lens.id]: "50mm" });
  });
});
