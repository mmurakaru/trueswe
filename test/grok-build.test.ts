import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchExperimentCommand } from "./command-test-support.ts";
import { startLocalLangfuseFixture } from "./local-langfuse-test-support.ts";
import type { ExperimentRecord } from "../helpers/experiment-record.ts";

test("Grok runs alone or with both agents and rejects subscription profiles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-grok-"));
  const langfuse = await startLocalLangfuseFixture();
  try {
    const helper = join(directory, "harbor-fixture");
    await cp("test/fixtures/harbor-fixture.mjs", helper);
    await chmod(helper, 0o700);
    await writeFile(
      helper + ".result.json",
      JSON.stringify({
        exception_info: null,
        verifier_environment_mode: "separate",
        verifier_result: { rewards: { reward: 1 } },
        agent_result: null,
      }),
    );
    const configuration = JSON.parse(await readFile("examples/grok-build-smoke.json", "utf8"));
    configuration.outputDirectory = join(directory, "grok");
    configuration.langfuse.baseUrl = langfuse.baseUrl;
    configuration.agents[0].authentication.keyEnvironment = "CUSTOM_GROK_AUTH";
    const configurationPath = join(directory, "configuration.json");
    await writeFile(configurationPath, JSON.stringify(configuration));
    const environment = {
      ...process.env,
      TRUESWE_HARBOR: helper,
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      CUSTOM_GROK_AUTH: "fixture-grok-credential",
      CUSTOM_CLAUDE_AUTH: "fixture-claude-credential",
      CUSTOM_CODEX_AUTH: "fixture-codex-credential",
    };
    const execution = await launchExperimentCommand(["run", configurationPath], environment);
    assert.equal(execution.status, 0, execution.output);
    const record: ExperimentRecord = JSON.parse(
      await readFile(join(configuration.outputDirectory, "experiment.json"), "utf8"),
    );
    assert.equal(record.attempts[0]?.outcome, "pass");
    const attemptDirectory = join(
      configuration.outputDirectory,
      "attempts/addition-grok-build-baseline-1",
    );
    const native = JSON.parse(await readFile(join(attemptDirectory, "harbor.json"), "utf8"));
    assert.equal(native.agents[0].kwargs.version, "1.0.77");
    assert.equal(native.agents[0].kwargs.reasoning_effort, "medium");
    assert.equal(native.agents[0].kwargs.kill_leftover_processes, true);
    assert.ok(native.agents[0].kwargs.background_wait_sec <= 30);
    assert.equal(native.agents[0].model_api_key_name, "CUSTOM_GROK_AUTH");
    assert.ok(
      !(await readFile(join(attemptDirectory, "harbor.log"), "utf8")).includes(
        environment.CUSTOM_GROK_AUTH,
      ),
    );
    assert.match(
      await readFile(join(attemptDirectory, "task/environment/Dockerfile"), "utf8"),
      /rm -f.*Claude.md.*config.toml/,
    );
    const codex = JSON.parse(await readFile("examples/codex-smoke.json", "utf8"));
    const claude = JSON.parse(await readFile("examples/claude-code-smoke.json", "utf8"));
    codex.agents[0].authentication = { method: "api-key", keyEnvironment: "CUSTOM_CODEX_AUTH" };
    claude.agents[0].authentication = { method: "api-key", keyEnvironment: "CUSTOM_CLAUDE_AUTH" };
    configuration.agents.push(codex.agents[0], claude.agents[0]);
    configuration.outputDirectory = join(directory, "all-agents");
    await writeFile(configurationPath, JSON.stringify(configuration));
    const all = await launchExperimentCommand(["run", configurationPath], environment);
    assert.equal(all.status, 0, all.output);
    const combined: ExperimentRecord = JSON.parse(
      await readFile(join(configuration.outputDirectory, "experiment.json"), "utf8"),
    );
    assert.equal(combined.attempts.length, 3);
    assert.ok(
      combined.attempts.every((attempt) => attempt.outcome === "pass" && attempt.traceIdentifier),
    );
    assert.deepEqual(
      new Set(combined.attempts.map((attempt) => attempt.agentName)),
      new Set(["codex", "claude-code", "grok-build"]),
    );
    configuration.agents[0].authentication = {
      method: "subscription",
      tokenEnvironment: "CUSTOM_GROK_AUTH",
    };
    await writeFile(configurationPath, JSON.stringify(configuration));
    const unsupported = await launchExperimentCommand(["plan", configurationPath], environment);
    assert.notEqual(unsupported.status, 0);
    assert.match(unsupported.output, /Grok subscription authentication is unsupported/);
  } finally {
    await langfuse.close();
    await rm(directory, { recursive: true, force: true });
  }
});
