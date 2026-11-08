import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { createHash } from "node:crypto";

test("GitHub source artifact contains an executable versioned Bend application", async () => {
  const build = spawnSync(process.execPath, ["scripts/build-release.ts"], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const firstArchiveName = build.stdout.trim();
  const stageDirectory = join("dist", firstArchiveName.replace(/\.tar\.gz$/, ""));
  await writeFile(join(stageDirectory, "helpers", "removed-source.ts"), "obsolete source");
  const rebuild = spawnSync(process.execPath, ["scripts/build-release.ts"], { encoding: "utf8" });
  assert.equal(rebuild.status, 0, rebuild.stderr);
  const contents = spawnSync("tar", ["-tzf", join("dist", firstArchiveName)], { encoding: "utf8" });
  assert.equal(contents.status, 0, contents.stderr);
  assert.doesNotMatch(contents.stdout, /removed-source/);
  const checksumText = await readFile("dist/checksums.txt", "utf8");
  const [expectedDigest, archiveName] = checksumText.trim().split(/\s+/);
  assert.ok(archiveName);
  assert.equal(
    createHash("sha256")
      .update(await readFile(join("dist", archiveName)))
      .digest("hex"),
    expectedDigest,
  );
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "trueswe-release-test-"));
  try {
    const extraction = spawnSync("tar", [
      "-xzf",
      resolve("dist", archiveName),
      "-C",
      temporaryDirectory,
    ]);
    assert.equal(extraction.status, 0);
    const extractedRoot = join(temporaryDirectory, archiveName.replace(/\.tar\.gz$/, ""));
    const dependencies = spawnSync("npm", ["ci", "--ignore-scripts"], {
      cwd: extractedRoot,
      encoding: "utf8",
    });
    assert.equal(dependencies.status, 0, dependencies.stderr);
    const template = parseEnv(await readFile(join(extractedRoot, ".env.example"), "utf8"));
    assert.ok(Object.keys(template).includes("CLAUDE_CODE_OAUTH_TOKEN"));
    assert.ok(Object.values(template).every((value) => value === ""));
    assert.match(await readFile(join(extractedRoot, ".gitignore"), "utf8"), /^\.env$/m);
    const setup = spawnSync("npm", ["run", "setup:env"], { cwd: extractedRoot, encoding: "utf8" });
    assert.equal(setup.status, 0, setup.stderr);
    assert.equal(
      parseEnv(await readFile(join(extractedRoot, ".env"), "utf8")).CLAUDE_CODE_OAUTH_TOKEN,
      "",
    );
    const execution = spawnSync(process.execPath, ["scripts/run-bend.ts", "--version"], {
      cwd: extractedRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        TRUESWE_BEND: process.env.TRUESWE_BEND ?? resolve(".tools/bend/bin/bend"),
      },
    });
    assert.equal(execution.status, 0, execution.stderr);
    assert.match(execution.stdout, /^trueswe \d+\.\d+\.\d+/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
