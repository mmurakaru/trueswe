import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import type { ExperimentRecord } from "../helpers/experiment-record.ts";

import { launchExperimentCommand } from "./command-test-support.ts";
import { startLocalLangfuseFixture } from "./local-langfuse-test-support.ts";

test("CLI preserves independently verified outcomes and distinguishes execution errors", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "trueswe-experiment-test-"));
  const langfuse = await startLocalLangfuseFixture();
  try {
    const outcomes = await Promise.allSettled(
      (
        [
          ["passing", 1, null, "completed", "pass"],
          ["failing", 0, null, "completed", "fail"],
          ["broken", 1, { exception_type: "AgentAuthenticationError" }, "execution-error", null],
          ["interrupted", 0, null, "interrupted", null],
          ["agent-timeout", 1, { exception_type: "AgentTimeoutError" }, "completed", "pass"],
          ["agent-refused", 0, { exception_type: "AgentSafetyRefusalError" }, "completed", "fail"],
          [
            "provider-unavailable",
            1,
            { exception_type: "ApiRateLimitError" },
            "execution-error",
            null,
          ],
        ] as const
      ).map(async ([name, reward, exception, expectedState, expectedOutcome]) => {
        const helper = join(temporaryDirectory, `harbor-${name}`);
        await cp("test/fixtures/harbor-fixture.mjs", helper);
        await chmod(helper, 0o700);
        await writeFile(
          helper + ".result.json",
          JSON.stringify({
            exception_info: exception,
            interruptParent: name === "interrupted",
            verifier_environment_mode: name === "broken" ? null : "separate",
            verifier_result: { rewards: { accuracy: reward } },
            agent_result: { n_input_tokens: null, n_output_tokens: null, cost_usd: null },
          }),
        );
        const configuration = JSON.parse(await readFile("examples/codex-smoke.json", "utf8"));
        configuration.name = name;
        if (name === "failing")
          configuration.agents[0].authentication = {
            method: "api-key",
            keyEnvironment: "CUSTOM_AUTH",
          };
        configuration.outputDirectory = join(temporaryDirectory, name);
        configuration.langfuse.baseUrl = langfuse.baseUrl;
        const configurationPath = join(temporaryDirectory, `${name}.json`);
        await writeFile(configurationPath, JSON.stringify(configuration));
        const execution = await launchExperimentCommand(["run", configurationPath], {
          ...process.env,
          TRUESWE_HARBOR: helper,
          LANGFUSE_PUBLIC_KEY: "pk-lf-test",
          LANGFUSE_SECRET_KEY: "sk-lf-test",
          CUSTOM_AUTH: "synthetic-credential-value",
          TRUESWE_CODEX_AUTH_FILE: resolvePath(temporaryDirectory, "unused-auth.json"),
        });
        assert.equal(execution.status, 0, execution.output);
        const record: ExperimentRecord = JSON.parse(
          await readFile(join(configuration.outputDirectory, "experiment.json"), "utf8"),
        );
        assert.equal(record.attempts[0]?.state, expectedState);
        assert.equal(record.attempts[0]?.outcome, expectedOutcome);
        if (expectedState === "completed") assert.equal(record.attempts[0]?.error, null);
        const nativeConfiguration = JSON.parse(
          await readFile(
            join(configuration.outputDirectory, "attempts/addition-codex-baseline-1/harbor.json"),
            "utf8",
          ),
        );
        assert.ok(
          nativeConfiguration.agents[0].override_timeout_sec +
            nativeConfiguration.agents[0].override_setup_timeout_sec +
            nativeConfiguration.verifier.override_timeout_sec <
            configuration.limits.attemptTimeoutSeconds,
        );
        assert.equal(record.attempts[0]?.costDollars, null);
        assert.ok(record.attempts[0]?.traceIdentifier);
        if (name === "failing")
          assert.doesNotMatch(
            await readFile(
              join(
                configuration.outputDirectory,
                "attempts",
                "addition-codex-baseline-1",
                "harbor.log",
              ),
              "utf8",
            ),
            /synthetic-credential-value/,
          );
        assert.match(
          await readFile(join(configuration.outputDirectory, "report.md"), "utf8"),
          /Cost: unknown/,
        );
      }),
    );
    for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
    assert.equal(langfuse.traceRequests(), 7);
  } finally {
    await langfuse.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("CLI rejects invalid profiles before planning agent attempts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-invalid-test-"));
  try {
    const path = join(directory, "invalid.json");
    await writeFile(path, JSON.stringify({ schemaVersion: 1 }));
    const result = await launchExperimentCommand(["plan", path], process.env);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /Invalid key/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
