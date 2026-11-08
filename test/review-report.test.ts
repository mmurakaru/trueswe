import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, cp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchExperimentCommand } from "./command-test-support.ts";
import { startLocalLangfuseFixture } from "./local-langfuse-test-support.ts";

async function waitForSecondAttempt(path: string, remaining = 1000): Promise<void> {
  const states = await readFile(path, "utf8").then(
    (text): string[] =>
      JSON.parse(text).attempts.map((attempt: { state: string }) => attempt.state),
    () => [],
  );
  if (states[0] === "completed" && states[1] === "running") return;
  if (remaining === 0) throw new Error("Second attempt did not start");
  await new Promise((resolve) => setTimeout(resolve, 20));
  return waitForSecondAttempt(path, remaining - 1);
}

test("a delayed review report keeps newer experiment outcomes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-review-report-"));
  const langfuse = await startLocalLangfuseFixture();
  const requestArrived = Promise.withResolvers<void>();
  const releaseResponse = Promise.withResolvers<void>();
  const children: ReturnType<typeof launchExperimentCommand>[] = [];
  const server = createServer(async (request, response) => {
    request.resume();
    requestArrived.resolve();
    await releaseResponse.promise;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        model: "jev-fixture",
        answers: {
          reviewCategory: {
            type: "choice",
            choice: "none",
            confidence: 1,
            probabilities: {
              "tool-failure": 0,
              "wrong-path": 0,
              "missing-context": 0,
              "task-misunderstanding": 0,
              none: 1,
            },
          },
        },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const releaseFile = join(directory, "release-attempt");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Review fixture did not bind");
    const helper = join(directory, "harbor-fixture");
    await cp("test/fixtures/harbor-fixture.mjs", helper);
    await chmod(helper, 0o700);
    await writeFile(
      helper + ".result.json",
      JSON.stringify({
        waitForFile: releaseFile,
        exception_info: null,
        verifier_environment_mode: "separate",
        verifier_result: { rewards: { reward: 1 } },
        agent_result: null,
        trajectory: { steps: [{ step_id: 1, source: "agent", message: "The task is complete." }] },
      }),
    );
    const configuration = JSON.parse(await readFile("examples/codex-smoke.json", "utf8"));
    configuration.outputDirectory = join(directory, "experiment");
    configuration.repetitions = 2;
    configuration.langfuse.baseUrl = langfuse.baseUrl;
    const configurationPath = join(directory, "configuration.json");
    await writeFile(configurationPath, JSON.stringify(configuration));
    const environment = {
      ...process.env,
      TRUESWE_HARBOR: helper,
      TRUESWE_CODEX_AUTH_FILE: join(directory, "unused-auth.json"),
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      TYPESAFE_API_KEY: "fixture-router-key",
      TYPESAFE_BASE_URL: `http://127.0.0.1:${address.port}`,
    };
    const execution = launchExperimentCommand(["run", configurationPath], environment);
    children.push(execution);
    await waitForSecondAttempt(join(configuration.outputDirectory, "experiment.json"));
    const requestPath = join(directory, "review.json");
    await writeFile(
      requestPath,
      JSON.stringify({
        schemaVersion: 1,
        experimentConfigurationPath: configurationPath,
        attemptIdentifier: "addition-codex-baseline-1",
        model: "jev-fixture",
      }),
    );
    const review = launchExperimentCommand(["review", requestPath], environment);
    children.push(review);
    await requestArrived.promise;
    await writeFile(releaseFile, "continue");
    const completed = await execution;
    assert.equal(completed.status, 0, completed.output);
    releaseResponse.resolve();
    const reviewed = await review;
    assert.equal(reviewed.status, 0, reviewed.output);
    const report = await readFile(join(configuration.outputDirectory, "report.md"), "utf8");
    assert.match(report, /addition-codex-baseline-2: completed, pass/);
    assert.match(report, /\| addition \| codex \| baseline \| 2 \| 0 \|/);
  } finally {
    releaseResponse.resolve();
    await writeFile(releaseFile, "continue");
    await Promise.allSettled(children);
    await langfuse.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
