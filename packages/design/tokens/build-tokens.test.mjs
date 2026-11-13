import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("the generated tokens.css and tokens.ts match tokens.json", () => {
  execFileSync(process.execPath, [fileURLToPath(new URL("./build-tokens.mjs", import.meta.url)), "--check"], { stdio: "pipe" });
});
