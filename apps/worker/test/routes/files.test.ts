/**
 * The file routes (step B0, #372): a file is made, listed, moved, binned, restored, purged, copied
 * and released through one set of routes, whatever its type. Folders and shortcuts are the core
 * types of this step; `t-note` stands in for the types later steps bring (a versioned body that
 * names files, references of its own), so those paths are tested before a real type needs them.
 */
import { env } from "cloudflare:workers";
import { MAX_BODY_BYTES, registerFileType, type FileType } from "@openclapper/model";
import { beforeAll, describe, expect, test } from "vitest";
import { api, folderBody, newUser, ok, runCron, shortcutBody, uuid, type User } from "./helpers.ts";

const NOTE: FileType = {
  type: "t-note", label: "Note", plural: "Notes", roots: ["project", "home"], refs: ["content"], version: 2,
  empty: () => ({ text: "", about: null }),
  check: (b) => (typeof b.text === "string" ? null : "text must be a string"),
  upgrade: (b) => ({ text: String(b.t ?? ""), about: null }),
  remap: (b, ids) => ({ ...b, about: typeof b.about === "string" ? ids.get(b.about) ?? b.about : null }),
};
registerFileType(NOTE);

interface FileOut {
  id: string; project_id: string | null; home: boolean; type: string; name: string; container: string | null; internal_of: string | null; fixed: string | null;
  created_by: string; deleted_at: string | null; lock: unknown; body_version: number; body?: Record<string, unknown>; refs?: { kind: string; to: string; data: unknown; missing: boolean }[]; binned_with?: number;
}

let u: User;
let project: string;
beforeAll(async () => { u = await newUser(); });

/** A project of its own per test, so lists hold only what the test made. */
async function newProject(): Promise<string> {
  const id = uuid();
  await ok(api(u.token, "PUT", `/api/projects/${id}`, { name: `P ${id}` }), 201);
  return (project = id);
}
const put = (id: string, body: unknown, status: number | number[] = [200, 201]) => ok<{ file: FileOut; error: string }>(api(u.token, "PUT", `/api/files/${id}`, body), status);
const folder = async (name: string, container: string | null = null) => { const id = uuid(); await put(id, folderBody({ project_id: project }, name, { container }), 201); return id; };
const note = async (name: string, extra: Record<string, unknown> = {}) => { const id = uuid(); await put(id, { type: "t-note", project_id: project, name, ...extra }, 201); return id; };
// The property definitions and settings pages every new project starts with sit in Settings; these tests are about the other files.
const files = async (query = "") => (await ok<{ files: FileOut[] }>(api(u.token, "GET", `/api/files?project_id=${project}${query}`))).files.filter((f) => f.type !== "property" && f.type !== "settings");
const names = async (query = "") => (await files(query)).map((f) => f.name);
const one = async (id: string) => (await ok<{ file: FileOut }>(api(u.token, "GET", `/api/files/${id}`))).file;
const post = (path: string, body: unknown, status: number | number[] = 200) => ok<Record<string, unknown> & { error: string }>(api(u.token, "POST", path, body), status);
const fixedOf = async (which: string) => (await files()).find((f) => f.fixed === which)!.id;

describe("a project's fixed folders", () => {
  test("a new project has Desktop and Settings; they cannot be renamed, moved, binned or copied", async () => {
    await newProject();
    const all = await files();
    expect(all.map((f) => [f.name, f.type, f.fixed])).toEqual([["Desktop", "folder", "desktop"], ["Settings", "folder", "settings"]]);
    const desktop = all[0].id, target = await folder("Somewhere");
    expect((await put(desktop, { name: "Schreibtisch" }, 400)).error).toMatch(/cannot be renamed or moved/);
    await put(desktop, { container: target }, 400);
    expect((await post("/api/files/move", { ids: [desktop], container: target }, 400)).error).toMatch(/cannot be moved/);
    expect((await post("/api/files/bin", { ids: [desktop] }, 400)).error).toMatch(/cannot be deleted/);
    await post(`/api/files/${desktop}/duplicate`, { id: uuid() }, 400);
    // Anything may sit on the Desktop; Settings takes only the types bound to it.
    await put(uuid(), shortcutBody(project, "Files", { container: desktop }), 201);
    expect((await put(uuid(), folderBody({ project_id: project }, "x", { container: await fixedOf("settings") }), 400)).error).toMatch(/Settings folder holds only/);
  });
});

describe("settings pages (#426)", () => {
  test("a new project's Settings holds its pages; they are made and kept by the server", async () => {
    await newProject();
    const all = (await ok<{ files: (FileOut & { body: { page: string } })[] }>(api(u.token, "GET", `/api/files?project_id=${project}&body=1`))).files;
    const settings = all.find((f) => f.fixed === "settings")!.id;
    const pages = all.filter((f) => f.type === "settings");
    expect(pages.map((f) => [f.name, f.body.page, f.container]).sort()).toEqual([["Extensions", "extensions", settings], ["Project", "project", settings]]);
    const page = pages[0].id;
    expect((await put(page, { name: "Mine" }, 400)).error).toMatch(/kept by the server/);
    expect((await put(uuid(), { type: "settings", project_id: project, container: settings, body: { page: "project" } }, 400)).error).toMatch(/kept by the server/);
    expect((await post("/api/files/bin", { ids: [page] }, 400)).error).toMatch(/settings page cannot be deleted/);
    expect((await post("/api/files/move", { ids: [page], container: null }, 400)).error).toMatch(/cannot be moved/);
    await post(`/api/files/${page}/duplicate`, { id: uuid() }, 400);
  });

  test("a home gets its Settings folder and pages when it is first listed, once", async () => {
    const someone = await newUser();
    const list = async () => (await ok<{ files: (FileOut & { body: { page: string } })[] }>(api(someone.token, "GET", "/api/files?home=1&body=1"))).files;
    const first = await list();
    const settings = first.find((f) => f.fixed === "settings")!;
    expect(settings).toMatchObject({ name: "Settings", type: "folder", home: true });
    expect(first.filter((f) => f.type === "settings").map((f) => [f.name, f.body.page, f.container]).sort()).toEqual([["Account", "account", settings.id], ["Appearance", "appearance", settings.id], ["Shortcuts", "shortcuts", settings.id]]);
    expect((await list()).length).toBe(first.length);
  });
});

describe("making and reading files", () => {
  test("a file is made with a name from its type's naming pattern and an empty body, read back, renamed, and listed", async () => {
    await newProject();
    const id = uuid();
    const made = await put(id, { type: "folder", project_id: project }, 201);
    expect(made.file).toMatchObject({ id, project_id: project, home: false, type: "folder", name: "Folder 001", container: null, internal_of: null, fixed: null, created_by: u.id, deleted_at: null, lock: null, body_version: 1, body: {}, refs: [] });
    expect((await put(id, { name: "  Scouting  " }, 200)).file.name).toBe("Scouting");
    // Names are free text: a second file may carry the same one.
    const twin = await folder("Scouting");
    expect((await one(twin)).name).toBe("Scouting");
    expect(await names("&container=top&type=folder")).toEqual(["Desktop", "Scouting", "Scouting", "Settings"]);
    expect((await files())[0].body).toBeUndefined();
    expect((await files("&body=1"))[0].body).toEqual({});
  });

  test("lists narrow by container, type and name", async () => {
    await newProject();
    const a = await folder("Alpha"), inner = await folder("Inner", a);
    await put(uuid(), shortcutBody(project, "Open files", { container: a }), 201);
    await note("Alpha notes");
    expect(await names(`&container=${a}`)).toEqual(["Inner", "Open files"]);
    expect(await names("&container=top")).toEqual(["Alpha", "Alpha notes", "Desktop", "Settings"]);
    expect(await names("&type=shortcut,t-note")).toEqual(["Alpha notes", "Open files"]);
    expect(await names("&q=ALPHA")).toEqual(["Alpha", "Alpha notes"]);
    expect(await names(`&container=${inner}`)).toEqual([]);
    // References come along when asked for, for every file listed.
    const link = uuid();
    await put(link, shortcutBody(project, "To alpha", { body: { app: null }, refs: [{ kind: "target", to: a }] }), 201);
    const withRefs = await files("&type=shortcut&refs=1&body=1");
    expect(withRefs.map((f) => [f.name, f.refs, f.body])).toEqual([["Open files", [], { app: "files" }], ["To alpha", [{ kind: "target", to: a, data: null, missing: false }], { app: null }]]);
    await post("/api/files/bin", { ids: [link] });
    await ok(api(u.token, "GET", `/api/files?project_id=${project}&type=rig`), 400);
    await ok(api(u.token, "GET", "/api/files"), 400);
    await ok(api(u.token, "GET", `/api/files?project_id=${project}&home=1`), 400);
  });

  test("what a file is never changes, and what it holds is checked by its type", async () => {
    await newProject();
    const other = uuid();
    await ok(api(u.token, "PUT", `/api/projects/${other}`, { name: `Other ${other}` }), 201);
    const id = await folder("Fixed type");
    expect((await put(id, { type: "shortcut" }, 400)).error).toMatch(/type never changes/);
    expect((await put(id, { project_id: other }, 400)).error).toMatch(/never moves to another project/);
    expect((await put(id, { home: true }, 400)).error).toMatch(/never moves/);
    expect((await put(uuid(), { type: "rig", project_id: project }, 400)).error).toMatch(/type must be one of: folder, shortcut/);
    expect((await put(uuid(), { type: "folder", project_id: project, name: " " }, 400)).error).toMatch(/non-empty/);
    expect((await put(id, { body: { colour: 2 } }, 400)).error).toMatch(/no "colour"/);
    expect((await put(uuid(), { type: "shortcut", project_id: project }, 400)).error).toMatch(/one of the two/);
    expect((await put(uuid(), shortcutBody(project, "x", { refs: [{ kind: "content", to: id }] }), 400)).error).toMatch(/keeps no "content"/);
    expect((await put(uuid(), { type: "folder", project_id: project, container: uuid() }, 400)).error).toMatch(/no such folder/);
    expect((await put(uuid(), ["folder"], 400)).error).toMatch(/expected a JSON object/);
  });

  test("a body and its references are checked together, whichever is sent", async () => {
    await newProject();
    const target = await folder("Target"), link = uuid();
    await put(link, shortcutBody(project, "Link", { body: { app: null }, refs: [{ kind: "target", to: target }] }), 201);
    // Only the body: the stored reference still counts, so naming an app as well is refused.
    expect((await put(link, { body: { app: "files" } }, 400)).error).toMatch(/one of the two/);
    // Only the references: the stored body still counts.
    expect((await put(link, { refs: [] }, 400)).error).toMatch(/one of the two/);
    const swapped = await put(link, { body: { app: "files" }, refs: [] }, 200);
    expect(swapped.file).toMatchObject({ body: { app: "files" }, refs: [] });
    // A rename touches neither.
    expect((await put(link, { name: "Still files" }, 200)).file).toMatchObject({ name: "Still files", body: { app: "files" } });
  });

  test("references keep their order and data; a body from an older version is upgraded on save", async () => {
    await newProject();
    const a = await folder("A"), b = await folder("B"), gone = uuid(), id = uuid();
    const made = await put(id, { type: "t-note", project_id: project, body: { t: "old shape" }, body_version: 1, refs: [{ kind: "content", to: b, data: { at_ms: 1500 } }, { kind: "content", to: gone }, { kind: "content", to: a }] }, 201);
    expect(made.file).toMatchObject({ body: { text: "old shape", about: null }, body_version: 2 });
    expect(made.file.refs).toEqual([
      { kind: "content", to: b, data: { at_ms: 1500 }, missing: false }, { kind: "content", to: gone, data: null, missing: true }, { kind: "content", to: a, data: null, missing: false },
    ]);
    expect((await put(id, { body: { text: "x" }, body_version: 3 }, 400)).error).toMatch(/newer version/);
    expect((await put(id, { body: { text: 5 } }, 400)).error).toMatch(/text must be a string/);
    // The references are replaced as a whole, and "where is this used" follows.
    await put(id, { refs: [{ kind: "content", to: a }] }, 200);
    const uses = (file: string) => ok<{ uses: { id: string; kind: string }[] }>(api(u.token, "GET", `/api/files/${file}/uses`));
    expect((await uses(a)).uses).toEqual([expect.objectContaining({ id, kind: "content", type: "t-note" })]);
    expect((await uses(b)).uses).toEqual([]);
  });

  test("the largest body the model allows is stored and read back; a larger one is refused", async () => {
    await newProject();
    const id = uuid(), text = "x".repeat(MAX_BODY_BYTES - 100);
    await put(id, { type: "t-note", project_id: project, body: { text, about: null } }, 201);
    expect((await one(id)).body!.text).toHaveLength(text.length);
    expect((await put(id, { body: { text: "x".repeat(MAX_BODY_BYTES), about: null } }, 400)).error).toMatch(/larger than/);
  });
});

describe("moving", () => {
  test("files move into a container and back to the top, all or none", async () => {
    await newProject();
    const a = await folder("A"), b = await folder("B"), n = await note("N");
    await post("/api/files/move", { ids: [b, n], container: a });
    expect(await names(`&container=${a}`)).toEqual(["B", "N"]);
    await put(n, { container: null }, 200);
    expect(await names(`&container=${a}`)).toEqual(["B"]);
    // One bad file refuses the whole request.
    const link = uuid();
    await put(link, shortcutBody(project, "L"), 201);
    expect((await post("/api/files/move", { ids: [n, a], container: link }, 400)).error).toMatch(/cannot contain files/);
    expect((await post("/api/files/move", { ids: [n, a], container: b }, 400)).error).toMatch(/inside itself/);
    expect(await names("&container=top")).toEqual(["A", "Desktop", "L", "N", "Settings"]);
    await post("/api/files/move", { ids: [], container: null }, 400);
    await post("/api/files/move", { ids: [n, uuid()], container: null }, 404);
  });

  test("containers nest at most 8 deep, counting what a moved folder holds", async () => {
    await newProject();
    let parent: string | null = null;
    const chain: string[] = [];
    for (let i = 1; i <= 8; i++) chain.push((parent = await folder(`L${i}`, parent)));
    expect((await put(uuid(), folderBody({ project_id: project }, "L9", { container: chain[7] }), 400)).error).toMatch(/at most 8 deep/);
    // A file that holds nothing does not count as a level.
    await put(uuid(), shortcutBody(project, "deep", { container: chain[7] }), 201);
    const tall = await folder("Tall"), inside = await folder("Inside", tall);
    await post("/api/files/move", { ids: [tall], container: chain[5] });
    expect((await post("/api/files/move", { ids: [tall], container: chain[6] }, 400)).error).toMatch(/at most 8 deep/);
    expect((await one(inside)).container).toBe(tall);
  });
});

describe("the recycle bin", () => {
  test("binning a folder takes its contents and their internal files along; restoring brings all back", async () => {
    await newProject();
    const top = await folder("Top"), sub = await folder("Sub", top), n = uuid(), internal = uuid(), link = uuid();
    await put(n, { type: "t-note", project_id: project, name: "Note", container: sub }, 201);
    await put(internal, { type: "t-note", project_id: project, name: "Made inside", internal_of: n }, 201);
    await put(link, shortcutBody(project, "To the note", { body: { app: null }, refs: [{ kind: "target", to: n }] }), 201);
    expect(await names(`&internal_of=${n}`)).toEqual(["Made inside"]);
    expect(await names()).not.toContain("Made inside");

    await post("/api/files/bin", { ids: [top] });
    expect(await names()).toEqual(["Desktop", "Settings", "To the note"]);
    const bin = await files("&bin=1");
    expect(bin.map((f) => [f.name, f.binned_with])).toEqual([["Top", 3]]);
    expect(bin[0].deleted_at).toBeTruthy();
    // While binned: readable, not changeable, and missing where it was used.
    expect((await one(n)).deleted_at).toBeTruthy();
    expect((await put(n, { name: "x" }, 409)).error).toMatch(/recycle bin/);
    expect((await one(link)).refs![0].missing).toBe(true);
    expect((await post("/api/files/restore", { ids: [sub] }, 400)).error).toMatch(/went to the bin with another file/);
    // Binning it again changes nothing.
    await post("/api/files/bin", { ids: [top] });
    expect((await files("&bin=1")).map((f) => f.binned_with)).toEqual([3]);

    expect(await post("/api/files/restore", { ids: [top] })).toMatchObject({ restored: [top], to_top: [] });
    expect(await names(`&container=${sub}`)).toEqual(["Note"]);
    expect(await names(`&internal_of=${n}`)).toEqual(["Made inside"]);
    expect((await one(link)).refs![0].missing).toBe(false);
    expect(await files("&bin=1")).toEqual([]);
  });

  test("a file binned on its own comes back at the top when its folder is gone or binned", async () => {
    await newProject();
    const a = await folder("A"), first = await note("First", { container: a }), second = await note("Second", { container: a });
    await post("/api/files/bin", { ids: [first] });
    await post("/api/files/bin", { ids: [a] });
    expect((await files("&bin=1")).map((f) => [f.name, f.binned_with]).sort()).toEqual([["A", 1], ["First", 0]]);
    expect(await post("/api/files/restore", { ids: [first] })).toMatchObject({ to_top: [first] });
    expect((await one(first)).container).toBeNull();
    // Purging the folder purges what went with it, nothing else.
    await post("/api/files/purge", { ids: [a] });
    await ok(api(u.token, "GET", `/api/files/${second}`), 404);
    expect((await one(first)).deleted_at).toBeNull();
  });

  test("files binned together with their folder go with the folder, whatever order they are named in", async () => {
    await newProject();
    const a = await folder("A"), n = await note("N", { container: a });
    await post("/api/files/bin", { ids: [n, a] });
    expect((await files("&bin=1")).map((f) => [f.name, f.binned_with])).toEqual([["A", 1]]);
  });

  test("an internal file binned on its own waits for its parent", async () => {
    await newProject();
    const n = await note("Parent"), internal = uuid();
    await put(internal, { type: "t-note", project_id: project, name: "Inside", internal_of: n }, 201);
    await post("/api/files/bin", { ids: [internal] });
    await post("/api/files/bin", { ids: [n] });
    expect((await post("/api/files/restore", { ids: [internal] }, 409)).error).toMatch(/belongs to a file that is in the bin/);
    await post("/api/files/restore", { ids: [n, internal] });
    expect(await names(`&internal_of=${n}`)).toEqual(["Inside"]);
    // Purged with its parent, binned or not.
    await post("/api/files/bin", { ids: [n] });
    await post("/api/files/purge", { ids: [n] });
    await ok(api(u.token, "GET", `/api/files/${internal}`), 404);
  });

  test("purge takes only what is in the bin; emptying the bin leaves live files", async () => {
    await newProject();
    const keep = await folder("Keep"), a = await folder("A"), b = await note("B");
    expect((await post("/api/files/purge", { ids: [keep] }, 400)).error).toMatch(/not in the recycle bin/);
    await post("/api/files/bin", { ids: [a, b] });
    expect(await ok(api(u.token, "DELETE", `/api/bin?project_id=${project}`))).toEqual({ purged: 2 });
    expect(await names()).toEqual(["Desktop", "Keep", "Settings"]);
    expect(await files("&bin=1")).toEqual([]);
  });

  test("the cron purges what has been in the bin for 30 days", async () => {
    await newProject();
    const old = await folder("Old"), inOld = await note("In old", { container: old }), recent = await folder("Recent");
    await post("/api/files/bin", { ids: [old] });
    await post("/api/files/bin", { ids: [recent] });
    const longAgo = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await env.DB.prepare("UPDATE files SET deleted_at = ?1 WHERE id IN (?2, ?3)").bind(longAgo, old, inOld).run();
    await runCron();
    expect((await files("&bin=1")).map((f) => f.name)).toEqual(["Recent"]);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM files WHERE id IN (?1, ?2)").bind(old, inOld).first()).toEqual({ n: 0 });
  });
});

describe("copies", () => {
  test("a copy takes its contents, internal files and references along, and is made once", async () => {
    await newProject();
    const outside = await folder("Outside"), top = await folder("Set"), n = uuid(), internal = uuid(), about = uuid(), copy = uuid();
    await put(about, { type: "t-note", project_id: project, name: "About", container: top }, 201);
    await put(n, { type: "t-note", project_id: project, name: "Note", container: top, body: { text: "hi", about }, refs: [{ kind: "content", to: about }, { kind: "content", to: outside }] }, 201);
    await put(internal, { type: "t-note", project_id: project, name: "Inside", internal_of: n }, 201);

    const made = await post(`/api/files/${top}/duplicate`, { id: copy }, 201) as unknown as { file: FileOut };
    expect(made.file).toMatchObject({ id: copy, name: "Set copy", container: null, type: "folder" });
    const inCopy = await files(`&container=${copy}&body=1`);
    expect(inCopy.map((f) => f.name)).toEqual(["About", "Note"]);
    const [aboutCopy, noteCopy] = inCopy;
    expect([aboutCopy.id, noteCopy.id]).not.toContain(about);
    // What was copied along is pointed at as the copy, in the references and in the body; the rest as before.
    expect((await one(noteCopy.id)).refs!.map((r) => r.to)).toEqual([aboutCopy.id, outside]);
    expect(noteCopy.body).toEqual({ text: "hi", about: aboutCopy.id });
    expect(await names(`&internal_of=${noteCopy.id}`)).toEqual(["Inside"]);
    // The original is untouched.
    expect((await one(n)).refs!.map((r) => r.to)).toEqual([about, outside]);
    expect(await names(`&internal_of=${n}`)).toEqual(["Inside"]);

    // The same request again answers with the copy that exists.
    const again = await post(`/api/files/${top}/duplicate`, { id: copy }, 200) as unknown as { file: FileOut };
    expect(again.file.id).toBe(copy);
    expect((await names()).filter((x) => x === "Set copy")).toHaveLength(1);
  });

  test("a copy can be named and placed; an internal file's copy stays with its parent", async () => {
    await newProject();
    const a = await folder("A"), n = await note("N"), internal = uuid(), second = uuid();
    await put(internal, { type: "t-note", project_id: project, name: "Inside", internal_of: n }, 201);
    const placed = await post(`/api/files/${n}/duplicate`, { id: uuid(), name: "N for A", container: a }, 201) as unknown as { file: FileOut };
    expect(placed.file).toMatchObject({ name: "N for A", container: a });
    await post(`/api/files/${internal}/duplicate`, { id: second }, 201);
    expect(await names(`&internal_of=${n}`)).toEqual(["Inside", "Inside copy"]);
    expect((await post(`/api/files/${internal}/duplicate`, { id: uuid(), container: a }, 400)).error).toMatch(/sits in no container/);
  });
});

describe("internal files", () => {
  test("made inside a file, hidden from the browser, released one-way", async () => {
    await newProject();
    const a = await folder("A"), n = await note("Parent"), internal = uuid();
    expect((await put(uuid(), folderBody({ project_id: project }, "x", { internal_of: n }), 400)).error).toMatch(/cannot be an internal file/);
    expect((await put(uuid(), { type: "t-note", project_id: project, internal_of: n, container: a }, 400)).error).toMatch(/sits in no container/);
    expect((await put(uuid(), { type: "t-note", project_id: project, internal_of: uuid() }, 400)).error).toMatch(/no such file here/);
    await put(internal, { type: "t-note", project_id: project, name: "Inside", internal_of: n }, 201);
    expect((await put(internal, { container: a }, 400)).error).toMatch(/sits in no container/);
    expect((await post("/api/files/move", { ids: [internal], container: a }, 400)).error).toMatch(/release it first/);
    expect((await put(internal, { internal_of: null }, 400)).error).toMatch(/release it/);

    const released = await post(`/api/files/${internal}/release`, { container: a }) as unknown as { file: FileOut };
    expect(released.file).toMatchObject({ internal_of: null, container: a });
    expect(await names(`&container=${a}`)).toEqual(["Inside"]);
    expect((await post(`/api/files/${internal}/release`, {}, 400)).error).toMatch(/not an internal file/);
  });
});

describe("the account home", () => {
  test("files of a home follow the person, not a project", async () => {
    const mine = uuid();
    const made = await put(mine, folderBody({ home: true }, "My layouts"), 201);
    expect(made.file).toMatchObject({ project_id: null, home: true });
    const home = (await ok<{ files: FileOut[] }>(api(u.token, "GET", "/api/files?home=1"))).files;
    expect(home.map((f) => f.id)).toContain(mine);
    expect(home.filter((f) => f.fixed).map((f) => f.name)).toEqual(["Settings"]);
    expect((await put(uuid(), { type: "shortcut", home: true, body: { app: "files" } }, 400)).error).toMatch(/belongs to a project/);
    await post("/api/files/bin", { ids: [mine] });
    expect(await ok(api(u.token, "DELETE", "/api/bin?home=1"))).toEqual({ purged: 1 });
  });
});

describe("roles", () => {
  test("a viewer reads a project's files and changes none", async () => {
    await newProject();
    const ws = uuid(), shared = uuid(), f = uuid();
    const viewer = await newUser();
    await ok(api(u.token, "PUT", `/api/workspaces/${ws}`, { name: "Crew" }));
    await ok(api(u.token, "POST", `/api/workspaces/${ws}/members`, { email: viewer.email, role: "viewer" }));
    await ok(api(u.token, "PUT", `/api/projects/${shared}`, { name: "Shared", workspace_id: ws }));
    await ok(api(u.token, "PUT", `/api/files/${f}`, folderBody({ project_id: shared }, "Seen")), 201);
    const v = (method: string, path: string, body?: unknown) => api(viewer.token, method, path, body);
    expect((await ok<{ files: FileOut[] }>(v("GET", `/api/files?project_id=${shared}`))).files.map((x) => x.name)).toContain("Seen");
    await ok(v("GET", `/api/files/${f}`));
    await ok(v("PUT", `/api/files/${f}`, { name: "Changed" }), 403);
    await ok(v("PUT", `/api/files/${uuid()}`, folderBody({ project_id: shared }, "New")), 403);
    await ok(v("POST", "/api/files/bin", { ids: [f] }), 403);
    await ok(v("POST", `/api/files/${f}/duplicate`, { id: uuid() }), 403);
    await ok(v("DELETE", `/api/bin?project_id=${shared}`), 403);
    // The viewer's own home is theirs to change.
    await ok(v("PUT", `/api/files/${uuid()}`, folderBody({ home: true }, "Mine")), 201);
  });
});
