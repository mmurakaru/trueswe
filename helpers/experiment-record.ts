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
export const managedSkillNameSchema = validation.pipe(
  validation.string(),
  validation.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  validation.maxLength(64),
);
const environmentReference = validation.pipe(
  validation.string(),
  validation.regex(/^[A-Z][A-Z0-9_]*$/),
);
const apiKeyAuthenticationSchema = validation.strictObject({
  method: validation.literal("api-key"),
  keyEnvironment: environmentReference,
});
const pinnedAgentVersionSchema = validation.pipe(
  validation.string(),
  validation.regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/),
);
const agentModelSchema = validation.pipe(validation.string(), validation.minLength(1));
const nativeAgentProfileSchema = validation.variant("name", [
  validation.strictObject({
    name: validation.literal("codex"),
    model: agentModelSchema,
    version: pinnedAgentVersionSchema,
    reasoningEffort: validation.picklist(["minimal", "low", "medium", "high", "xhigh", "max"]),
    authentication: validation.variant("method", [
      apiKeyAuthenticationSchema,
      validation.strictObject({
        method: validation.literal("subscription"),
        credentialPathEnvironment: environmentReference,
      }),
    ]),
  }),
  validation.strictObject({
    name: validation.literal("claude-code"),
    model: agentModelSchema,
    version: pinnedAgentVersionSchema,
    reasoningEffort: validation.picklist(["low", "medium", "high", "xhigh", "max"]),
    authentication: validation.variant("method", [
      apiKeyAuthenticationSchema,
      validation.strictObject({
        method: validation.literal("subscription"),
        tokenEnvironment: environmentReference,
      }),
    ]),
  }),
  validation.strictObject({
    name: validation.literal("grok-build"),
    model: agentModelSchema,
    version: pinnedAgentVersionSchema,
    reasoningEffort: validation.picklist([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]),
    authentication: validation.strictObject({
      method: validation.literal(
        "api-key",
        "Grok subscription authentication is unsupported; use an API-key profile",
      ),
      keyEnvironment: environmentReference,
    }),
  }),
]);
export const localLangfuseConnectionSchema = validation.strictObject({
  baseUrl: validation.pipe(validation.string(), validation.url()),
  projectIdentifier: validation.string(),
});
const managedSkillSelectionSchema = validation.union([
  validation.strictObject({ name: managedSkillNameSchema, version: positiveInteger }),
  validation.strictObject({
    name: managedSkillNameSchema,
    label: validation.pipe(validation.string(), validation.minLength(1)),
  }),
]);
export const experimentConfigurationSchema = validation.strictObject({
  schemaVersion: validation.literal(1),
  name: safeIdentifier,
  outputDirectory: validation.string(),
  comparisonKind: validation.optional(
    validation.picklist(["instructions", "skills"]),
    "instructions",
  ),
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
  agents: validation.pipe(validation.array(nativeAgentProfileSchema), validation.minLength(1)),
  variants: validation.pipe(
    validation.array(
      validation.strictObject({
        name: safeIdentifier,
        instructionsPath: validation.string(),
        skills: validation.optional(validation.array(managedSkillSelectionSchema), []),
      }),
    ),
    validation.minLength(1),
    validation.maxLength(2),
  ),
  repetitions: validation.optional(positiveInteger, 3),
  limits: validation.strictObject({
    attemptTimeoutSeconds: validation.pipe(positiveInteger, validation.maxValue(3000)),
    concurrency: positiveInteger,
  }),
  langfuse: localLangfuseConnectionSchema,
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
  exceptionType: string | null;
  skillLoads: { name: string; version: number; path: string; eventReference: string }[];
  skillLoadEvidence: "observed" | "unknown" | "not-supplied";
}
export interface ExperimentRecord {
  schemaVersion: 2;
  configurationHash: string;
  configuration: ExperimentConfiguration;
  createdAt: string;
  attempts: AttemptRecord[];
  frozenInputs: FrozenExperimentInputs;
  inputHash: string;
}

export interface FrozenExperimentInputs {
  tasks: {
    identifier: string;
    contentHash: string;
    snapshotHash: string | null;
    issueUrl: string | null;
    startingCommit: string | null;
  }[];
  variants: { name: string; instructionsHash: string; instructionsContent: string }[];
  skills: {
    variantName: string;
    name: string;
    version: number;
    contentHash: string;
    directoryHash: string;
    files: { path: string; sha256Hash: string }[];
  }[];
  runtime: {
    nodeVersion: string;
    bendVersion: string;
    harborVersion: string;
    helperContentHash: string;
    bendContentHash: string;
    packageLockHash: string;
  };
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
    else if ("tokenEnvironment" in profile.authentication)
      registerCredentialEnvironmentReference(profile.authentication.tokenEnvironment);
  for (const [label, names] of [
    ["task", configuration.tasks.map((task) => task.identifier)],
    ["agent", configuration.agents.map((profile) => profile.name)],
    ["variant", configuration.variants.map((variant) => variant.name)],
  ] as const) {
    if (new Set(names).size !== names.length)
      throw new Error(`Duplicate experiment ${label} identifiers are not allowed`);
  }
  if (
    configuration.variants.length === 2 &&
    !["baseline", "candidate"].every((name) =>
      configuration.variants.some((variant) => variant.name === name),
    )
  )
    throw new Error("A comparison requires baseline and candidate variants");
  const attemptCount =
    configuration.tasks.length *
    configuration.agents.length *
    configuration.variants.length *
    configuration.repetitions;
  if (!Number.isSafeInteger(attemptCount) || attemptCount > 10_000)
    throw new Error("Experiment exceeds the 10000 attempt limit");
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
  schemaVersion: validation.literal(2),
  configurationHash: validation.string(),
  configuration: experimentConfigurationSchema,
  createdAt: validation.string(),
  inputHash: validation.string(),
  frozenInputs: validation.object({
    tasks: validation.array(
      validation.object({
        identifier: validation.string(),
        contentHash: validation.string(),
        snapshotHash: nullableText,
        issueUrl: nullableText,
        startingCommit: nullableText,
      }),
    ),
    variants: validation.array(
      validation.object({
        name: validation.string(),
        instructionsHash: validation.string(),
        instructionsContent: validation.string(),
      }),
    ),
    skills: validation.optional(
      validation.array(
        validation.object({
          variantName: validation.string(),
          name: validation.string(),
          version: validation.number(),
          contentHash: validation.string(),
          directoryHash: validation.string(),
          files: validation.array(
            validation.object({ path: validation.string(), sha256Hash: validation.string() }),
          ),
        }),
      ),
      [],
    ),
    runtime: validation.object({
      nodeVersion: validation.string(),
      bendVersion: validation.string(),
      harborVersion: validation.string(),
      helperContentHash: validation.string(),
      bendContentHash: validation.string(),
      packageLockHash: validation.string(),
    }),
  }),
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
      exceptionType: validation.optional(nullableText, null),
      skillLoads: validation.optional(
        validation.array(
          validation.object({
            name: validation.string(),
            version: validation.number(),
            path: validation.string(),
            eventReference: validation.string(),
          }),
        ),
        [],
      ),
      skillLoadEvidence: validation.optional(
        validation.picklist(["observed", "unknown", "not-supplied"]),
        "unknown",
      ),
    }),
  ),
});

export async function readExperimentRecord(path: string): Promise<ExperimentRecord> {
  const record = validation.parse(experimentRecordSchema, JSON.parse(await readFile(path, "utf8")));
  if (record.configurationHash !== hashExperimentContent(JSON.stringify(record.configuration)))
    throw new Error("Stored experiment configuration changed");
  return record;
}
