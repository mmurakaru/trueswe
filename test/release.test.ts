import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

test("GitHub source artifact contains an executable versioned Bend application", async () => {
  const build = spawnSync(process.execPath, ["scripts/build-release.ts"], { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
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
