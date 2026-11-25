#!/usr/bin/env node
// Every local dev server's port, in one place (docs/development.md, "Ports"). Each server has its own port and its
// own debugger (inspector) port, none of them moves to another one when it is taken (Vite strictPort, wrangler
// --port), and every start command checks its ports first: when one is taken it names the process that holds it
// and stops, instead of a server quietly taking a neighbour's port.
//
//   node scripts/ports.mjs need <server…>   exit 1 with what holds a port, when one of these servers' ports is taken
//   node scripts/ports.mjs list             the table
//   node scripts/ports.mjs port <name>      one port (for shell scripts)
import { execFileSync } from "node:child_process";
import { readlinkSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Server → its ports. `inspector`: wrangler's debugger port; two Workers on the same one collide. */
export const PORTS = {
  worker: { http: 8787, inspector: 9229, what: "the Worker (apps/worker)" },
  studio: { http: 5173, what: "the Studio (apps/studio)" },
  admin: { http: 5174, what: "the admin board (apps/admin, Vite)" },
  "admin-worker": { http: 8788, inspector: 9230, what: "the admin board's Worker (apps/admin)" },
  specimen: { http: 5175, what: "the design specimens (apps/specimen)" },
  metro: { http: 8081, what: "Metro, the phone app's bundler (make mobile)" },
};

/** Every port of these servers, with the server it belongs to. */
export const portsOf = (names) => names.flatMap((n) => {
  const p = PORTS[n];
  if (!p) throw new Error(`no server "${n}" (one of ${Object.keys(PORTS).join(", ")})`);
  return [{ server: n, port: p.http, role: "" }, ...(p.inspector ? [{ server: n, port: p.inspector, role: " (debugger)" }] : [])];
});

/** Whether something listens on the port (on any local address a dev server would use). */
export function taken(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", (e) => resolve(e.code === "EADDRINUSE" || e.code === "EACCES"));
    s.once("listening", () => s.close(() => resolve(false)));
    s.listen(port, host);
  });
}

/** Who holds a port, as far as this machine says (ss on Linux and WSL; lsof elsewhere), or null. */
export function holder(port) {
  let pid = null;
  try { pid = /pid=(\d+)/.exec(execFileSync("ss", ["-ltnpH", `sport = :${port}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))?.[1] ?? null; } catch { /* no ss */ }
  if (!pid) { try { pid = execFileSync("lsof", ["-t", "-iTCP:" + port, "-sTCP:LISTEN"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0] || null; } catch { /* no lsof */ } }
  if (!pid) return null;
  let cmd = "", cwd = "";
  try { cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean).join(" "); } catch { /* not Linux */ }
  try { cwd = readlinkSync(`/proc/${pid}/cwd`); } catch { /* not ours to read */ }
  return { pid, cmd, cwd };
}

/** The ports of these servers that are taken, each with what holds it. */
export async function check(names) {
  const out = [];
  for (const p of portsOf(names)) if (await taken(p.port)) out.push({ ...p, by: holder(p.port) });
  return out;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function explain(t) {
  const who = t.by ? `pid ${t.by.pid}${t.by.cmd ? `: ${t.by.cmd.slice(0, 120)}` : ""}${t.by.cwd ? ` (in ${t.by.cwd})` : ""}` : "a process this user cannot see";
  return `  :${t.port} for ${PORTS[t.server].what}${t.role} is taken by ${who}`;
}

async function main(argv) {
  const [cmd, ...names] = argv;
  if (cmd === "list") {
    for (const [n, p] of Object.entries(PORTS)) console.log(`${n.padEnd(13)} :${p.http}${p.inspector ? `  debugger :${p.inspector}` : ""}  ${p.what}`);
    return 0;
  }
  if (cmd === "port") { const [name, kind = "http"] = names; const v = PORTS[name]?.[kind]; if (!v) { console.error(`no port ${name} ${kind}`); return 1; } console.log(v); return 0; }
  if (cmd !== "need" || !names.length) { console.error("usage: ports.mjs need <server…> | list | port <server> [http|inspector]"); return 2; }
  const busy = await check(names);
  if (!busy.length) return 0;
  console.error(`Cannot start: a port it needs is in use.\n${busy.map(explain).join("\n")}`);
  const ours = busy.some((t) => t.by?.cwd?.startsWith(root));
  let session = false;
  try { execFileSync("tmux", ["has-session", "-t", "openclapper"], { stdio: "ignore" }); session = true; } catch { /* no tmux or no session */ }
  if (session) console.error("`make all` is running (tmux session openclapper): use its servers (make all attaches), or stop it with `make all-down`.");
  else if (ours) console.error("It is a server of this repository started elsewhere: stop it (Ctrl-C in its terminal), or `make all-down` to stop every leftover.");
  else console.error("Stop that process, or free the port.");
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
