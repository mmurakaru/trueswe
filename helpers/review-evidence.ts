import type { JsonValue } from "@typesafe-ai/sdk";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import * as validation from "valibot";
import type { ExperimentRecord, AttemptRecord } from "./experiment-record.ts";
import { frozenTaskDirectory } from "./experiment-freeze.ts";
import { redactRuntimeSecrets, registerCredentialValue } from "./secret-redaction.ts";

function registerCredentialFields(value: unknown, name = ""): void {
  if (typeof value === "string" && /token|key|secret|password/i.test(name))
    registerCredentialValue(value);
  else if (value && typeof value === "object")
    for (const [key, entry] of Object.entries(value)) registerCredentialFields(entry, key);
}

export async function registerCredentialFileValues(record: ExperimentRecord): Promise<void> {
  await Promise.all(
    record.configuration.agents.map(async (agent) => {
      if (
        agent.authentication.method !== "subscription" ||
        !("credentialPathEnvironment" in agent.authentication)
      )
        return;
      const path = process.env[agent.authentication.credentialPathEnvironment];
      if (!path) return;
      try {
        if ((await stat(path)).size > 1_000_000)
          throw new Error("Credential file exceeds the supported size");
        registerCredentialFields(JSON.parse(await readFile(path, "utf8")));
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
        throw new Error("Credential file could not be read for evidence redaction", {
          cause: error,
        });
      }
    }),
  );
}

function excerpt(text: string, byteLimit: number): { text: string; truncated: boolean } {
  const safe = redactRuntimeSecrets(text);
  const bytes = Buffer.from(safe);
  return bytes.length <= byteLimit
    ? { text: safe, truncated: false }
    : { text: bytes.subarray(0, byteLimit - 3).toString("utf8"), truncated: true };
}

function redactEvidenceStrings(value: unknown): unknown {
  if (typeof value === "string") return redactRuntimeSecrets(value);
  if (Array.isArray(value)) return value.map(redactEvidenceStrings);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [name, redactEvidenceStrings(entry)]),
    );
  return value;
}

const trajectorySchema = validation.object({
  steps: validation.array(
    validation.object({ step_id: validation.union([validation.string(), validation.number()]) }),
  ),
});

export async function readReviewEvidence(
  record: ExperimentRecord,
  attempt: AttemptRecord,
): Promise<{
  state: Record<string, JsonValue>;
  references: string[];
  trajectoryAvailable: boolean;
}> {
  await registerCredentialFileValues(record);
  const instruction = await readFile(
    join(frozenTaskDirectory(record.configuration, attempt.taskIdentifier), "instruction.md"),
    "utf8",
  );
  const variant = record.frozenInputs.variants.find((item) => item.name === attempt.variantName);
  const agent = record.configuration.agents.find((item) => item.name === attempt.agentName);
  const references = ["task:instruction", "project:instructions"];
  let trajectory = "Trajectory evidence is unavailable";
  let trajectoryAvailable = false;
  if (attempt.trajectoryPath) {
    try {
      if ((await stat(attempt.trajectoryPath)).size <= 2_000_000) {
        const content = await readFile(attempt.trajectoryPath, "utf8");
        const parsed: unknown = JSON.parse(content);
        const steps = validation.safeParse(trajectorySchema, parsed);
        if (steps.success)
          references.push(...steps.output.steps.map((step) => `trajectory:step:${step.step_id}`));
        trajectory = JSON.stringify(redactEvidenceStrings(parsed));
        trajectoryAvailable = true;
        references.push("trajectory");
      } else trajectory = "Trajectory exceeds the evidence read limit; inspect it locally";
    } catch {
      trajectory = "Trajectory evidence could not be read; inspect it locally";
    }
  }
  const tail = Buffer.from(trajectory).subarray(-10_000).toString("utf8");
  return {
    state: {
      attempt: {
        identifier: attempt.identifier,
        state: attempt.state,
        outcome: attempt.outcome,
        exceptionType: attempt.exceptionType,
      },
      agent: agent
        ? {
            name: agent.name,
            model: agent.model,
            version: agent.version,
            reasoningEffort: agent.reasoningEffort,
          }
        : null,
      taskInstruction: excerpt(instruction, 2000),
      projectInstructions: excerpt(variant?.instructionsContent ?? "", 2000),
      trajectory: excerpt(tail, 10_000),
      trajectoryTruncated: Buffer.byteLength(trajectory) > 10_000,
    },
    references,
    trajectoryAvailable,
  };
}
