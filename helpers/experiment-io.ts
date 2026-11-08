import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import {
  readExperimentConfiguration,
  hashExperimentContent,
  experimentRecordPath,
  writeExperimentRecord,
  readExperimentRecord,
} from "./experiment-record.ts";
import type { ExperimentRecord, AttemptRecord } from "./experiment-record.ts";
import { checkLocalLangfuse, recordLangfuseAttempt } from "./local-langfuse.ts";
import { executeHarborAttempt } from "./harbor-attempt.ts";
import { writeExperimentReport } from "./experiment-report.ts";
import { freezeExperimentInputs, verifyFrozenExperimentInputs } from "./experiment-freeze.ts";

export async function prepareExperiment(configurationPath: string): Promise<number> {
  const configuration = await readExperimentConfiguration(configurationPath);
  await checkLocalLangfuse(configuration);
  const recordPath = experimentRecordPath(configuration);
  const outputDirectory = resolve(configuration.outputDirectory);
  await mkdir(dirname(outputDirectory), { recursive: true });
  try {
    await mkdir(outputDirectory, { mode: 0o700 });
  } catch {
    throw new Error(
      "Experiment output already exists or cannot be created; choose a new output directory",
    );
  }
  const frozenInputs = await freezeExperimentInputs(configuration);
  const attempts: AttemptRecord[] = [];
  for (const task of configuration.tasks)
    for (const profile of configuration.agents)
      for (const variant of configuration.variants)
        for (let repetition = 1; repetition <= configuration.repetitions; repetition += 1) {
          attempts.push({
            identifier: `${task.identifier}-${profile.name}-${variant.name}-${repetition}`,
            ordinal: attempts.length,
            taskIdentifier: task.identifier,
            agentName: profile.name,
            variantName: variant.name,
            repetition,
            state: "pending",
            outcome: null,
            startedAt: null,
            finishedAt: null,
            durationSeconds: null,
            trajectoryPath: null,
            traceIdentifier: null,
            inputTokens: null,
            outputTokens: null,
            costDollars: null,
            error: null,
          });
        }
  if (attempts.length > 10_000) throw new Error("Experiment exceeds the 10000 attempt limit");
  const record: ExperimentRecord = {
    schemaVersion: 2,
    configurationHash: hashExperimentContent(JSON.stringify(configuration)),
    configuration,
    createdAt: new Date().toISOString(),
    attempts,
    frozenInputs,
    inputHash: hashExperimentContent(JSON.stringify(frozenInputs)),
  };
  await writeExperimentRecord(recordPath, record);
  await writeExperimentReport(record);
  console.error(
    `Planned ${attempts.length} attempts. Results: ${resolve(configuration.outputDirectory)}`,
  );
  return attempts.length;
}

export async function executeExperimentOrdinal(
  configurationPath: string,
  ordinal: number,
): Promise<number> {
  const configuration = await readExperimentConfiguration(configurationPath);
  const record = await readExperimentRecord(experimentRecordPath(configuration));
  if (record.configurationHash !== hashExperimentContent(JSON.stringify(configuration)))
    throw new Error("Frozen experiment configuration changed");
  await verifyFrozenExperimentInputs(record);
  const attempt = record.attempts[ordinal];
  if (!attempt || attempt.state !== "pending")
    throw new Error("Attempt is absent or already started");
  return executeHarborAttempt(record, attempt);
}

export async function finalizeExperimentOrdinal(
  configurationPath: string,
  ordinal: number,
  state: string,
  outcome: string,
): Promise<void> {
  if (
    !["completed", "execution-error", "interrupted"].includes(state) ||
    !["pass", "fail", "none"].includes(outcome)
  )
    throw new Error("Invalid Bend attempt decision");
  const configuration = await readExperimentConfiguration(configurationPath);
  const record = await readExperimentRecord(experimentRecordPath(configuration));
  const attempt = record.attempts[ordinal];
  if (!attempt || attempt.state !== "running")
    throw new Error("Attempt has no pending verification decision");
  attempt.state =
    state === "completed"
      ? "completed"
      : state === "interrupted"
        ? "interrupted"
        : "execution-error";
  attempt.outcome = outcome === "pass" ? "pass" : outcome === "fail" ? "fail" : null;
  await writeExperimentRecord(experimentRecordPath(configuration), record);
  try {
    attempt.traceIdentifier = await recordLangfuseAttempt(configuration, attempt);
  } catch {
    attempt.error = [
      attempt.error,
      "Local Langfuse trace export failed; local attempt evidence is preserved",
    ]
      .filter(Boolean)
      .join(". ");
  }
  await writeExperimentRecord(experimentRecordPath(configuration), record);
  await writeExperimentReport(record);
  console.error(
    `${attempt.identifier}: ${attempt.state}, ${attempt.outcome ?? "no verified outcome"}`,
  );
}
