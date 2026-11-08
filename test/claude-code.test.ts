import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchExperimentCommand } from "./command-test-support.ts";
import { startLocalLangfuseFixture } from "./local-langfuse-test-support.ts";
import type { ExperimentRecord } from "../helpers/experiment-record.ts";

test("Claude Code uses explicit API or subscription credentials with controlled instructions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-claude-"));
  const langfuse = await startLocalLangfuseFixture();
  try {
    const helper = join(directory, "harbor-fixture");
    await cp("test/fixtures/harbor-fixture.mjs", helper);
    await chmod(helper, 0o700);
    const configuration = JSON.parse(await readFile("examples/claude-code-smoke.json", "utf8"));
    configuration.langfuse.baseUrl = langfuse.baseUrl;
    const configurationPath = join(directory, "configuration.json");
    const environment = {
      ...process.env,
      TRUESWE_HARBOR: helper,
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      CUSTOM_CLAUDE_AUTH: "fixture-api-credential",
      CUSTOM_SUBSCRIPTION: "fixture-subscription-credential",
      OPENAI_API_KEY: "unrelated-secret",
      ANTHROPIC_API_KEY: "unrelated-default-key",
      CLAUDE_CODE_OAUTH_TOKEN: "unrelated-default-token",
    };
    async function verifyMethod(method: "api-key" | "subscription"): Promise<void> {
      configuration.outputDirectory = join(directory, method);
      configuration.agents[0].authentication =
        method === "api-key"
          ? { method, keyEnvironment: "CUSTOM_CLAUDE_AUTH" }
          : { method, tokenEnvironment: "CUSTOM_SUBSCRIPTION" };
      await writeFile(configurationPath, JSON.stringify(configuration));
      await writeFile(
        helper + ".result.json",
        JSON.stringify({
          exception_info: null,
          verifier_environment_mode: "separate",
          verifier_result: { rewards: { reward: 1 } },
          agent_result: null,
          requiredEnvironmentNames:
            method === "api-key"
              ? ["CUSTOM_CLAUDE_AUTH"]
              : ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_FORCE_OAUTH"],
          forbiddenEnvironmentNames:
            method === "api-key"
              ? ["OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]
              : ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CUSTOM_CLAUDE_AUTH"],
        }),
      );
      const execution = await launchExperimentCommand(["run", configurationPath], environment);
      assert.equal(execution.status, 0, execution.output);
      const record: ExperimentRecord = JSON.parse(
        await readFile(join(configuration.outputDirectory, "experiment.json"), "utf8"),
      );
      assert.equal(record.attempts[0]?.outcome, "pass");
      const attemptDirectory = join(
        configuration.outputDirectory,
        "attempts/addition-claude-code-baseline-1",
      );
      const native = JSON.parse(await readFile(join(attemptDirectory, "harbor.json"), "utf8"));
      assert.equal(native.agents[0].kwargs.version, "2.1.319");
      assert.equal(native.agents[0].kwargs.reasoning_effort, "medium");
      assert.equal("config" in native.agents[0].kwargs, false);
      const dockerfile = await readFile(
        join(attemptDirectory, "task/environment/Dockerfile"),
        "utf8",
      );
      assert.match(dockerfile, /COPY CLAUDE.md \/app\/CLAUDE.md/);
      assert.match(dockerfile, /rm -f.*settings\.json/);
      assert.equal(
        await readFile(join(attemptDirectory, "task/environment/CLAUDE.md"), "utf8"),
        "@AGENTS.md\n",
      );
      const log = await readFile(join(attemptDirectory, "harbor.log"), "utf8");
      assert.ok(!log.includes(environment.CUSTOM_CLAUDE_AUTH));
      assert.ok(!log.includes(environment.CUSTOM_SUBSCRIPTION));
      assert.ok(record.attempts[0]?.traceIdentifier);
    }
    await verifyMethod("api-key");
    await verifyMethod("subscription");
  } finally {
    await langfuse.close();
    await rm(directory, { recursive: true, force: true });
  }
});
