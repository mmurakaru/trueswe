import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseEnv } from "node:util";
import { configureLocalEnvironment } from "../helpers/environment-setup.ts";

test("environment setup creates private credentials and preserves configured values on repeat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-environment-"));
  const path = join(directory, ".env");
  try {
    await configureLocalEnvironment(path);
    const initial = await readFile(path, "utf8");
    const values = parseEnv(initial);
    assert.ok(values.POSTGRES_PASSWORD && values.POSTGRES_PASSWORD.length >= 32);
    assert.notEqual(values.POSTGRES_PASSWORD, values.CLICKHOUSE_PASSWORD);
    assert.equal(values.CLAUDE_CODE_OAUTH_TOKEN, "");
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await configureLocalEnvironment(path);
    assert.equal(await readFile(path, "utf8"), initial);
    await writeFile(
      path,
      '# Keep custom values.\nexport CLAUDE_CODE_OAUTH_TOKEN="fixture-token"\nPOSTGRES_PASSWORD="fixture-password"\nCUSTOM_SETTING="fixture-setting"',
      { mode: 0o644 },
    );
    await Promise.all([configureLocalEnvironment(path), configureLocalEnvironment(path)]);
    const updated = await readFile(path, "utf8");
    const parsed = parseEnv(updated);
    assert.equal(parsed.CLAUDE_CODE_OAUTH_TOKEN, "fixture-token");
    assert.equal(parsed.POSTGRES_PASSWORD, "fixture-password");
    assert.equal(parsed.CUSTOM_SETTING, "fixture-setting");
    assert.match(updated, /^# Keep custom values\./);
    assert.equal(updated.match(/^XAI_API_KEY=/gm)?.length, 1);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    const template = parseEnv(await readFile(".env.example", "utf8"));
    assert.deepEqual(Object.keys(template).toSorted(), Object.keys(values).toSorted());
    assert.ok(Object.values(template).every((value) => value === ""));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
