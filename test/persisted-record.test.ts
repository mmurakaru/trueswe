import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readExperimentRecord, readExperimentConfiguration } from "../helpers/experiment-record.ts";

test("record validation rejects incomplete attempts and an unsafe process budget", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-record-validation-"));
  try {
    const path = join(directory, "record.json");
    await writeFile(path, JSON.stringify({ schemaVersion: 1, attempts: [{ state: "completed" }] }));
    await assert.rejects(readExperimentRecord(path));
    const configuration = JSON.parse(await readFile("examples/codex-smoke.json", "utf8"));
    configuration.limits.attemptTimeoutSeconds = 3001;
    await writeFile(path, JSON.stringify(configuration));
    await assert.rejects(readExperimentConfiguration(path));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
