import * as validation from "valibot";
import { createHash } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { registerCredentialEnvironmentReference } from "./secret-redaction.ts";

const positiveInteger = validation.pipe(
  validation.number(),
  validation.integer(),
  validation.minValue(1),
);
const safeIdentifier = validation.pipe(
  validation.string(),
  validation.regex(/^[a-z][a-z0-9-]{0,63}$/),
);
const environmentReference = validation.pipe(
  validation.string(),
  validation.regex(/^[A-Z][A-Z0-9_]*$/),
);
const authenticationSchema = validation.variant("method", [
  validation.strictObject({
    method: validation.literal("subscription"),
    credentialPathEnvironment: environmentReference,
  }),
  validation.strictObject({
    method: validation.literal("api-key"),
    keyEnvironment: environmentReference,
  }),
]);
export const experimentConfigurationSchema = validation.strictObject({
  schemaVersion: validation.literal(1),
  name: safeIdentifier,
  outputDirectory: validation.string(),
  tasks: validation.pipe(
    validation.array(
      validation.strictObject({
        identifier: safeIdentifier,
        path: validation.string(),
        split: validation.picklist(["development", "reserved"]),
      }),
    ),
    validation.minLength(1),
  ),
  agents: validation.pipe(
    validation.array(
      validation.strictObject({
        name: validation.literal("codex"),
        model: validation.pipe(validation.string(), validation.minLength(1)),
        version: validation.pipe(
          validation.string(),
          validation.regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/),
        ),
        reasoningEffort: validation.picklist(["minimal", "low", "medium", "high", "xhigh", "max"]),
        authentication: authenticationSchema,
      }),
    ),
    validation.minLength(1),
  ),
  variants: validation.pipe(
    validation.array(
      validation.strictObject({ name: safeIdentifier, instructionsPath: validation.string() }),
    ),
    validation.minLength(1),
  ),
  repetitions: validation.optional(positiveInteger, 3),
  limits: validation.strictObject({
    attemptTimeoutSeconds: validation.pipe(positiveInteger, validation.maxValue(1100)),
    concurrency: positiveInteger,
  }),
  langfuse: validation.strictObject({
    baseUrl: validation.pipe(validation.string(), validation.url()),
    projectIdentifier: validation.string(),
  }),
});
export type ExperimentConfiguration = validation.InferOutput<typeof experimentConfigurationSchema>;
export interface AttemptRecord {
  identifier: string;
  ordinal: number;
  taskIdentifier: string;
  agentName: string;
  variantName: string;
  repetition: number;
  state: "pending" | "running" | "completed" | "interrupted" | "execution-error";
  outcome: "pass" | "fail" | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationSeconds: number | null;
  trajectoryPath: string | null;
  traceIdentifier: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costDollars: number | null;
  error: string | null;
}
export interface ExperimentRecord {
  schemaVersion: 1;
  configurationHash: string;
  configuration: ExperimentConfiguration;
  createdAt: string;
  attempts: AttemptRecord[];
}

export function hashExperimentContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function readExperimentConfiguration(path: string): Promise<ExperimentConfiguration> {
  const configuration = validation.parse(
    experimentConfigurationSchema,
    JSON.parse(await readFile(path, "utf8")),
  );
  for (const profile of configuration.agents)
    if (profile.authentication.method === "api-key")
      registerCredentialEnvironmentReference(profile.authentication.keyEnvironment);
  return configuration;
}

export function experimentRecordPath(configuration: ExperimentConfiguration): string {
  return resolve(configuration.outputDirectory, "experiment.json");
}

export async function writeExperimentRecord(path: string, value: ExperimentRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporaryPath, path);
}

const nullableNumber = validation.nullable(validation.number());
const nullableText = validation.nullable(validation.string());
const experimentRecordSchema = validation.object({
  schemaVersion: validation.literal(1),
  configurationHash: validation.string(),
  configuration: experimentConfigurationSchema,
  createdAt: validation.string(),
  attempts: validation.array(
    validation.object({
      identifier: validation.string(),
      ordinal: validation.number(),
      taskIdentifier: validation.string(),
      agentName: validation.string(),
      variantName: validation.string(),
      repetition: validation.number(),
      state: validation.picklist([
        "pending",
        "running",
        "completed",
        "interrupted",
        "execution-error",
      ]),
      outcome: validation.nullable(validation.picklist(["pass", "fail"])),
      startedAt: nullableText,
      finishedAt: nullableText,
      durationSeconds: nullableNumber,
      trajectoryPath: nullableText,
      traceIdentifier: nullableText,
      inputTokens: nullableNumber,
      outputTokens: nullableNumber,
      costDollars: nullableNumber,
      error: nullableText,
    }),
  ),
});

export async function readExperimentRecord(path: string): Promise<ExperimentRecord> {
  const record = validation.parse(experimentRecordSchema, JSON.parse(await readFile(path, "utf8")));
  if (record.configurationHash !== hashExperimentContent(JSON.stringify(record.configuration)))
    throw new Error("Stored experiment configuration changed");
  return record;
}
