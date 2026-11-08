import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, writeFile, readFile, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runExternalProcess } from "../helpers/child-process-io.ts";

test("CLI serializes cold compilation and recompiles changed Bend source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-cli-cache-"));
  try {
    const application = join(directory, "application");
    await mkdir(join(application, "scripts"), { recursive: true });
    await Promise.all([
      cp("src", join(application, "src"), { recursive: true }),
      cp("helpers", join(application, "helpers"), { recursive: true }),
      cp("scripts/run-bend.ts", join(application, "scripts/run-bend.ts")),
      cp("package.json", join(application, "package.json")),
      symlink(
        fileURLToPath(new URL("../node_modules", import.meta.url)),
        join(application, "node_modules"),
        "dir",
      ),
    ]);
    const compiler = join(directory, "compiler");
    const counter = join(directory, "compilations.log");
    await cp("test/fixtures/slow-compiler.mjs", compiler);
    await chmod(compiler, 0o700);
    const environment = {
      ...process.env,
      TRUESWE_BEND: compiler,
      TRUESWE_REAL_BEND:
        process.env.TRUESWE_BEND ??
        fileURLToPath(new URL("../.tools/bend/bin/bend", import.meta.url)),
      TRUESWE_COMPILATION_COUNTER: counter,
    };
    const starts = await Promise.allSettled(
      [1, 2].map(() =>
        runExternalProcess(
          process.execPath,
          [join(application, "scripts/run-bend.ts"), "--help"],
          environment,
          50_000,
        ),
      ),
    );
    const outputs: string[] = [];
    for (const start of starts) {
      if (start.status === "rejected") throw start.reason;
      assert.equal(start.value.status, 0, start.value.errors);
      outputs.push(start.value.output);
    }
    assert.equal(outputs[0], outputs[1]);
    assert.equal((await readFile(counter, "utf8")).trim().split("\n").length, 1);
    const sourcePath = join(application, "src/main.bend");
    const source = await readFile(sourcePath, "utf8");
    await writeFile(
      sourcePath,
      source.replace('IO.print("TrueSWE\\n\\nUsage', 'IO.print("Updated source\\n\\nUsage'),
    );
    const changed = spawnSync(
      process.execPath,
      [join(application, "scripts/run-bend.ts"), "--help"],
      { encoding: "utf8", env: environment },
    );
    assert.equal(changed.status, 0, changed.stderr);
    assert.match(changed.stdout, /^Updated source/);
    assert.equal((await readFile(counter, "utf8")).trim().split("\n").length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
