import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, chmod, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchExperimentCommand, startExperimentCommand } from "./command-test-support.ts";
import { startLocalLangfuseFixture } from "./local-langfuse-test-support.ts";
import type { ExperimentRecord } from "../helpers/experiment-record.ts";

async function waitForPath(path: string, remaining = 500): Promise<void> {
  if (
    await access(path).then(
      () => true,
      () => false,
    )
  )
    return;
  if (remaining === 0) throw new Error("Experiment did not reach the interruption point");
  await new Promise((complete) => setTimeout(complete, 20));
  return waitForPath(path, remaining - 1);
}

test("explicit resume preserves verified passes and failures, retries unfinished work and keeps execution evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-resume-"));
  const langfuse = await startLocalLangfuseFixture();
  let command: ReturnType<typeof startExperimentCommand> | null = null;
  try {
    const helper = join(directory, "harbor-fixture");
    await cp("test/fixtures/harbor-fixture.mjs", helper);
    await chmod(helper, 0o700);
    const readyPath = join(directory, "ready");
    const invocationsPath = join(directory, "invocations");
    const fixture = {
      exception_info: null,
      verifier_environment_mode: "separate",
      verifier_result: { rewards: { reward: 1 } },
      agent_result: null,
      pauseOnRepetition: 3,
      failOnRepetition: 2,
      readyPath,
      invocationsPath,
      ignoreTermination: true,
    };
    await writeFile(helper + ".result.json", JSON.stringify(fixture));
    const configuration = JSON.parse(await readFile("examples/codex-smoke.json", "utf8"));
    configuration.repetitions = 4;
    configuration.outputDirectory = join(directory, "experiment");
    configuration.langfuse.baseUrl = langfuse.baseUrl;
    const configurationPath = join(directory, "configuration.json");
    await writeFile(configurationPath, JSON.stringify(configuration));
    const environment = {
      ...process.env,
      TRUESWE_HARBOR: helper,
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      TRUESWE_CODEX_AUTH_FILE: join(directory, "unused-auth.json"),
    };
    command = startExperimentCommand(["run", configurationPath], environment);
    await waitForPath(readyPath);
    const recordPath = join(configuration.outputDirectory, "experiment.json");
    const original: ExperimentRecord = JSON.parse(await readFile(recordPath, "utf8"));
    assert.deepEqual(
      original.attempts.slice(0, 2).map((attempt) => attempt.outcome),
      ["pass", "fail"],
    );
    const competing = await launchExperimentCommand(["resume", configurationPath], environment);
    assert.notEqual(competing.status, 0);
    assert.match(competing.output, /lock|already/i);
    command.child.kill("SIGTERM");
    const interrupted = await command.completion;
    assert.equal(interrupted.status, 143, interrupted.output);
    const stopped: ExperimentRecord = JSON.parse(await readFile(recordPath, "utf8"));
    assert.deepEqual(stopped.attempts.slice(0, 2), original.attempts.slice(0, 2));
    assert.equal(stopped.attempts[2]?.state, "interrupted");
    assert.ok(stopped.attempts[2]?.trajectoryPath);
    const trajectory = await readFile(stopped.attempts[2]!.trajectoryPath!, "utf8");
    assert.match(trajectory, /Work before interruption/);
    fixture.pauseOnRepetition = 0;
    await writeFile(helper + ".result.json", JSON.stringify(fixture));
    const resumed = await launchExperimentCommand(["resume", configurationPath], environment);
    assert.equal(resumed.status, 0, resumed.output);
    const completedBytes = await readFile(recordPath, "utf8");
    const completed: ExperimentRecord = JSON.parse(completedBytes);
    assert.deepEqual(completed.attempts.slice(0, 2), original.attempts.slice(0, 2));
    assert.ok(completed.attempts.every((attempt) => attempt.state === "completed"));
    assert.equal(completed.attempts[2]?.executionNumber, 2);
    assert.equal(completed.attempts[2]?.traceIdentifier, original.attempts[2]?.traceIdentifier);
    assert.equal(
      completed.attempts[2]?.observationIdentifier,
      original.attempts[2]?.observationIdentifier,
    );
    assert.equal(completed.attempts[2]?.executionHistory[0]?.state, "interrupted");
    assert.equal(await readFile(stopped.attempts[2]!.trajectoryPath!, "utf8"), trajectory);
    assert.match(
      await readFile(join(configuration.outputDirectory, "report.md"), "utf8"),
      /Previous execution 1: interrupted/,
    );
    const reportBytes = await readFile(join(configuration.outputDirectory, "report.md"), "utf8");
    const traces = langfuse.traceRequests();
    const repeated = await launchExperimentCommand(["resume", configurationPath], environment);
    assert.equal(repeated.status, 0, repeated.output);
    assert.equal(await readFile(recordPath, "utf8"), completedBytes);
    assert.equal(
      await readFile(join(configuration.outputDirectory, "report.md"), "utf8"),
      reportBytes,
    );
    assert.equal(langfuse.traceRequests(), traces);
    assert.equal((await readFile(invocationsPath, "utf8")).trim().split("\n").length, 5);
    configuration.agents[0].reasoningEffort = "high";
    await writeFile(configurationPath, JSON.stringify(configuration));
    const changed = await launchExperimentCommand(["resume", configurationPath], environment);
    assert.notEqual(changed.status, 0);
    assert.match(changed.output, /configuration changed/);
    assert.equal(await readFile(recordPath, "utf8"), completedBytes);
  } finally {
    command?.child.kill("SIGTERM");
    await command?.completion;
    await langfuse.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("interruption recovers a completed independent verifier result without another model attempt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-recover-"));
  const langfuse = await startLocalLangfuseFixture();
  let command: ReturnType<typeof startExperimentCommand> | null = null;
  try {
    const helper = join(directory, "harbor-fixture");
    await cp("test/fixtures/harbor-fixture.mjs", helper);
    await chmod(helper, 0o700);
    const readyPath = join(directory, "ready");
    const invocationsPath = join(directory, "invocations");
    await writeFile(
      helper + ".result.json",
      JSON.stringify({
        exception_info: null,
        verifier_environment_mode: "separate",
        verifier_result: { rewards: { reward: 1 } },
        agent_result: null,
        pauseOnRepetition: 1,
        writeResultBeforePause: true,
        readyPath,
        invocationsPath,
      }),
    );
    const docker = join(directory, "docker-fixture");
    await cp("test/fixtures/docker-fixture.mjs", docker);
    await chmod(docker, 0o700);
    const cleanupLogPath = join(directory, "cleanup.jsonl");
    await writeFile(
      docker + ".json",
      JSON.stringify({
        logPath: cleanupLogPath,
        containers: "aabbccddeeff",
        networks: "aabbccddeeff trial__env\nbbccddeeffaa unrelated-project",
      }),
    );
    const configuration = JSON.parse(await readFile("examples/codex-smoke.json", "utf8"));
    configuration.outputDirectory = join(directory, "experiment");
    configuration.langfuse.baseUrl = langfuse.baseUrl;
    const configurationPath = join(directory, "configuration.json");
    await writeFile(configurationPath, JSON.stringify(configuration));
    const environment = {
      ...process.env,
      TRUESWE_DOCKER: docker,
      TRUESWE_HARBOR: helper,
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      TRUESWE_CODEX_AUTH_FILE: join(directory, "unused-auth.json"),
    };
    command = startExperimentCommand(["run", configurationPath], environment);
    await waitForPath(readyPath);
    command.child.kill("SIGTERM");
    const interrupted = await command.completion;
    assert.equal(interrupted.status, 143, interrupted.output);
    const recordPath = join(configuration.outputDirectory, "experiment.json");
    const recovered: ExperimentRecord = JSON.parse(await readFile(recordPath, "utf8"));
    assert.equal(recovered.attempts[0]?.state, "completed");
    assert.equal(recovered.attempts[0]?.outcome, "pass");
    assert.equal(recovered.attempts[0]?.executionNumber, 1);
    const cleanup: string[][] = (await readFile(cleanupLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(
      cleanup.some((argumentsList) =>
        argumentsList.includes(
          "label=com.docker.compose.project.working_dir=" +
            join(
              configuration.outputDirectory,
              "attempts/addition-codex-baseline-1/task/environment",
            ),
        ),
      ),
    );
    assert.ok(
      cleanup.some(
        (argumentsList) => argumentsList.join(" ") === "container rm --force aabbccddeeff",
      ),
    );
    assert.ok(
      cleanup.some((argumentsList) => argumentsList.join(" ") === "network rm aabbccddeeff"),
    );
    assert.ok(
      cleanup.every(
        (argumentsList) =>
          !argumentsList.includes("bbccddeeffaa") && !argumentsList.includes("prune"),
      ),
    );
    const resumed = await launchExperimentCommand(["resume", configurationPath], environment);
    assert.equal(resumed.status, 0, resumed.output);
    assert.equal((await readFile(invocationsPath, "utf8")).trim().split("\n").length, 1);
  } finally {
    command?.child.kill("SIGTERM");
    await command?.completion;
    await langfuse.close();
    await rm(directory, { recursive: true, force: true });
  }
});
