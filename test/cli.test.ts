import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("Bend CLI explains its interface and rejects unknown commands", () => {
  const help = spawnSync(process.execPath, ["scripts/run-bend.ts", "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: trueswe/);
  const unknown = spawnSync(process.execPath, ["scripts/run-bend.ts", "unknown"], {
    encoding: "utf8",
  });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown command/);
});

test("Bend CLI reports the installed application version", () => {
  const result = spawnSync(process.execPath, ["scripts/run-bend.ts", "--version"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /trueswe \d+\.\d+\.\d+/);
});

test("Bend CLI explains how to install a missing compiler", () => {
  const result = spawnSync(process.execPath, ["scripts/run-bend.ts", "--help"], {
    encoding: "utf8",
    env: { ...process.env, TRUESWE_BEND: "/missing/trueswe-bend-compiler" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run npm run setup/);
});
