import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { runExternalProcess } from "../helpers/child-process-io.ts";

test("process timeout kills descendants after the group leader exits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-process-"));
  let descendant: number | null = null;
  try {
    const marker = join(directory, "descendant");
    const script = join(directory, "parent.mjs");
    await writeFile(
      script,
      `import {spawn} from 'node:child_process';
const child = spawn(process.execPath, ['--input-type=module', '-e', 'import {writeFileSync} from "node:fs"; process.on("SIGTERM",()=>{}); writeFileSync(process.argv[1],String(process.pid)); setInterval(()=>{},1000);', process.argv[2]], {stdio:'ignore'});
setInterval(()=>{},1000);
`,
    );
    const result = await runExternalProcess(process.execPath, [script, marker], process.env, 1000);
    assert.equal(result.timedOut, true);
    descendant = Number(await readFile(marker, "utf8"));
    const state = spawnSync("ps", ["-p", String(descendant), "-o", "stat="], { encoding: "utf8" });
    assert.ok(
      state.status !== 0 || state.stdout.trim().startsWith("Z"),
      "Timed-out descendant is still running",
    );
  } finally {
    if (descendant) {
      try {
        process.kill(descendant, "SIGKILL");
      } catch {
        /* The descendant has exited. */
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});
