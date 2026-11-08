import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchExperimentCommand } from "./command-test-support.ts";
import { startLocalLangfuseFixture } from "./local-langfuse-test-support.ts";
import type { ExperimentRecord } from "../helpers/experiment-record.ts";

test("comparison CLI runs three attempts per variant and stops changed instruction inputs", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "trueswe-comparison-test-"));
  const langfuse = await startLocalLangfuseFixture();
  try {
    const helper = join(temporaryDirectory, "harbor-fixture");
    await cp("test/fixtures/harbor-fixture.mjs", helper);
    await chmod(helper, 0o700);
    const baselinePath = join(temporaryDirectory, "baseline.md");
    const candidatePath = join(temporaryDirectory, "candidate.md");
    await writeFile(baselinePath, "Baseline instructions");
    await writeFile(candidatePath, "Candidate instructions");
    const fixture = {
      exception_info: null,
      verifier_environment_mode: "separate",
      verifier_result: { rewards: { reward: 0 } },
      agent_result: null,
      rewardByInstruction: { "Baseline instructions": 0, "Candidate instructions": 1 },
    };
    await writeFile(helper + ".result.json", JSON.stringify(fixture));
    const configuration = JSON.parse(
      await readFile("examples/instruction-comparison.json", "utf8"),
    );
    configuration.outputDirectory = join(temporaryDirectory, "comparison");
    configuration.langfuse.baseUrl = langfuse.baseUrl;
    configuration.variants = [
      { name: "baseline", instructionsPath: baselinePath },
      { name: "candidate", instructionsPath: candidatePath },
    ];
    const configurationPath = join(temporaryDirectory, "configuration.json");
    await writeFile(configurationPath, JSON.stringify(configuration));
    const environment = {
      ...process.env,
      TRUESWE_HARBOR: helper,
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      TRUESWE_CODEX_AUTH_FILE: join(temporaryDirectory, "unused-auth.json"),
    };
    const plan = await launchExperimentCommand(["plan", configurationPath], environment);
    assert.equal(plan.status, 0, plan.output);
    assert.equal(JSON.parse(plan.output).attempts, 6);
    const execution = await launchExperimentCommand(["run", configurationPath], environment);
    assert.equal(execution.status, 0, execution.output);
    const record: ExperimentRecord = JSON.parse(
      await readFile(join(configuration.outputDirectory, "experiment.json"), "utf8"),
    );
    assert.equal(record.attempts.length, 6);
    assert.equal(
      record.attempts.filter(
        (attempt) => attempt.variantName === "baseline" && attempt.outcome === "fail",
      ).length,
      3,
    );
    assert.equal(
      record.attempts.filter(
        (attempt) => attempt.variantName === "candidate" && attempt.outcome === "pass",
      ).length,
      3,
    );
    assert.equal(record.frozenInputs.variants[0]?.instructionsContent, "Baseline instructions");
    assert.equal(record.frozenInputs.variants[1]?.instructionsContent, "Candidate instructions");
    const report = await readFile(join(configuration.outputDirectory, "report.md"), "utf8");
    assert.match(report, /\| addition \| codex \| baseline \| 0 \| 3 \|/);
    assert.match(report, /\| addition \| codex \| candidate \| 3 \| 0 \|/);
    configuration.outputDirectory = join(temporaryDirectory, "changed-input");
    await writeFile(configurationPath, JSON.stringify(configuration));
    await writeFile(
      helper + ".result.json",
      JSON.stringify({ ...fixture, mutateInputPath: candidatePath }),
    );
    const changed = await launchExperimentCommand(["run", configurationPath], environment);
    assert.notEqual(changed.status, 0);
    assert.match(changed.output, /Frozen instruction input changed/);
    const interrupted: ExperimentRecord = JSON.parse(
      await readFile(join(configuration.outputDirectory, "experiment.json"), "utf8"),
    );
    assert.equal(interrupted.attempts.filter((attempt) => attempt.state === "completed").length, 1);
    assert.equal(interrupted.attempts.filter((attempt) => attempt.state === "pending").length, 5);
    assert.equal(langfuse.traceRequests(), 7);
    configuration.repetitions = 10001;
    await writeFile(configurationPath, JSON.stringify(configuration));
    const oversized = await launchExperimentCommand(["plan", configurationPath], environment);
    assert.notEqual(oversized.status, 0);
    assert.match(oversized.output, /10000 attempt limit/);
  } finally {
    await langfuse.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
