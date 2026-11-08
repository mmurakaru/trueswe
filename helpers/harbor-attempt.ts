import { readFile, writeFile, mkdir, cp, readdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { verifyTaskSnapshot } from "./task-snapshot.ts";
import { frozenTaskDirectory, frozenInstructionPath } from "./experiment-freeze.ts";
import * as validation from "valibot";
import { runExternalProcess } from "./child-process-io.ts";
import { requireEnvironmentVariable } from "./local-langfuse.ts";
import { writeExperimentRecord, experimentRecordPath } from "./experiment-record.ts";
import {
  redactRuntimeSecrets,
  registerCredentialEnvironmentReference,
} from "./secret-redaction.ts";
import type { ExperimentRecord, AttemptRecord } from "./experiment-record.ts";
import { harborProgramPath } from "./harbor-runtime.ts";
import { stageAttemptSkills } from "./skill-supply.ts";
import { frozenSkillDirectory } from "./managed-skills.ts";

const harborResultSchema = validation.object({
  verifier_environment_mode: validation.nullable(validation.picklist(["separate", "shared"])),
  exception_info: validation.nullable(validation.object({ exception_type: validation.string() })),
  verifier_result: validation.nullable(
    validation.object({
      rewards: validation.nullable(validation.record(validation.string(), validation.number())),
    }),
  ),
  agent_result: validation.nullable(
    validation.object({
      n_input_tokens: validation.nullable(validation.number()),
      n_output_tokens: validation.nullable(validation.number()),
      cost_usd: validation.nullable(validation.number()),
    }),
  ),
});

async function findHarborResult(directory: string): Promise<string | null> {
  const entries = await readdir(directory, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  const candidates = await Promise.all(
    directories.map(async (entry) => {
      const files = await readdir(join(directory, entry.name));
      return files.includes("result.json") && files.includes("config.json")
        ? join(directory, entry.name)
        : null;
    }),
  );
  return candidates.find((candidate) => candidate !== null) ?? null;
}

function applyHarborTrial(
  attempt: AttemptRecord,
  trial: validation.InferOutput<typeof harborResultSchema>,
  resultDirectory: string,
): number {
  const rewards = trial.verifier_result?.rewards;
  attempt.exceptionType = trial.exception_info?.exception_type ?? null;
  attempt.trajectoryPath = join(resultDirectory, "agent", "trajectory.json");
  attempt.inputTokens = trial.agent_result?.n_input_tokens ?? null;
  attempt.outputTokens = trial.agent_result?.n_output_tokens ?? null;
  attempt.costDollars = trial.agent_result?.cost_usd ?? null;
  if (!rewards || Object.keys(rewards).length === 0) {
    attempt.error = trial.exception_info?.exception_type ?? "Verifier produced no valid reward";
    return 0;
  }
  if (trial.verifier_environment_mode !== "separate") {
    attempt.error = "Authoritative task verification must run in a separate environment";
    return 0;
  }
  return Object.values(rewards).every((reward) => reward === 1) ? 1 : 2;
}

function harborProcessEnvironment(
  record: ExperimentRecord,
  attempt: AttemptRecord,
): NodeJS.ProcessEnv {
  const profile = record.configuration.agents.find((agent) => agent.name === attempt.agentName);
  if (!profile) throw new Error("Attempt agent profile is missing");
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "SSL_CERT_FILE",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
  ]) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  if (profile.authentication.method === "subscription") {
    if ("credentialPathEnvironment" in profile.authentication)
      environment.CODEX_AUTH_JSON_PATH = requireEnvironmentVariable(
        profile.authentication.credentialPathEnvironment,
      );
    else {
      environment.CLAUDE_FORCE_OAUTH = "1";
      environment.CLAUDE_CODE_OAUTH_TOKEN = requireEnvironmentVariable(
        profile.authentication.tokenEnvironment,
      );
    }
  } else
    environment[profile.authentication.keyEnvironment] = requireEnvironmentVariable(
      profile.authentication.keyEnvironment,
    );
  return environment;
}

export async function executeHarborAttempt(
  record: ExperimentRecord,
  attempt: AttemptRecord,
): Promise<number> {
  const configuration = record.configuration;
  const task = configuration.tasks.find((item) => item.identifier === attempt.taskIdentifier);
  const profile = configuration.agents.find((item) => item.name === attempt.agentName);
  const variant = configuration.variants.find((item) => item.name === attempt.variantName);
  if (!task || !profile || !variant)
    throw new Error("Attempt references an unknown experiment input");
  if (profile.authentication.method === "api-key")
    registerCredentialEnvironmentReference(profile.authentication.keyEnvironment);
  const attemptDirectory = resolve(configuration.outputDirectory, "attempts", attempt.identifier);
  await mkdir(attemptDirectory, { recursive: true });
  const taskPath = join(attemptDirectory, "task");
  const snapshotDirectory = dirname(resolve(task.path));
  if (existsSync(join(snapshotDirectory, "snapshot.json"))) {
    const snapshot = await verifyTaskSnapshot(snapshotDirectory);
    if (snapshot.identifier !== task.identifier || snapshot.split !== task.split)
      throw new Error("Task snapshot identity or split does not match the experiment");
    await cp(join(snapshotDirectory, "snapshot.json"), join(attemptDirectory, "snapshot.json"));
  }
  await cp(frozenTaskDirectory(configuration, task.identifier), taskPath, {
    recursive: true,
    verbatimSymlinks: true,
  });
  await cp(
    frozenInstructionPath(configuration, variant.name),
    join(taskPath, "environment", "AGENTS.md"),
  );
  const dockerfilePath = join(taskPath, "environment", "Dockerfile");
  await writeFile(
    dockerfilePath,
    (await readFile(dockerfilePath, "utf8")) + "\nCOPY AGENTS.md /app/AGENTS.md\n",
  );
  if (profile.name === "claude-code") {
    await writeFile(join(taskPath, "environment", "CLAUDE.md"), "@AGENTS.md\n");
    await writeFile(
      dockerfilePath,
      (await readFile(dockerfilePath, "utf8")) +
        "\nRUN rm -f /app/CLAUDE.local.md /app/.claude/CLAUDE.md /app/.claude/settings.json /app/.claude/settings.local.json /app/.mcp.json && rm -rf /app/.claude/rules /app/.claude/commands /app/.claude/agents /app/.claude/output-styles\nCOPY CLAUDE.md /app/CLAUDE.md\n",
    );
  }
  if (profile.name === "grok-build") {
    await writeFile(
      dockerfilePath,
      (await readFile(dockerfilePath, "utf8")) +
        "\nRUN rm -f /app/CLAUDE.md /app/Claude.md /app/CLAUDE.local.md /app/Agents.md /app/AGENT.md /app/.mcp.json /app/.claude.json /app/.cursor/mcp.json\n",
    );
  }
  await stageAttemptSkills(record, attempt, taskPath);
  const harborConfiguration = {
    job_name: "job",
    jobs_dir: attemptDirectory,
    n_attempts: 1,
    n_concurrent_trials: 1,
    retry: { max_retries: 0 },
    environment: { type: "docker", delete: true },
    verifier: {
      override_timeout_sec: Math.max(1, Math.floor(configuration.limits.attemptTimeoutSeconds / 5)),
    },
    agents: [
      {
        name: profile.name,
        model_name: profile.model,
        skills: record.frozenInputs.skills
          .filter((skill) => skill.variantName === attempt.variantName)
          .map((skill) => frozenSkillDirectory(configuration, attempt.variantName, skill.name)),
        ...(profile.authentication.method === "api-key"
          ? { model_api_key_name: profile.authentication.keyEnvironment }
          : {}),
        override_timeout_sec: Math.max(
          1,
          Math.floor(configuration.limits.attemptTimeoutSeconds / 2),
        ),
        override_setup_timeout_sec: Math.max(
          1,
          Math.floor(configuration.limits.attemptTimeoutSeconds / 5),
        ),
        kwargs: {
          version: profile.version,
          reasoning_effort: profile.reasoningEffort,
          ...(profile.name === "codex" ? { config: {} } : {}),
          ...(profile.name === "grok-build"
            ? {
                background_wait_sec: Math.max(
                  1,
                  Math.min(30, Math.floor(configuration.limits.attemptTimeoutSeconds / 10)),
                ),
                kill_leftover_processes: true,
              }
            : {}),
        },
      },
    ],
    tasks: [{ path: taskPath }],
  };
  const configurationPath = join(attemptDirectory, "harbor.json");
  await writeFile(configurationPath, JSON.stringify(harborConfiguration, null, 2) + "\n", {
    mode: 0o600,
  });
  attempt.state = "running";
  attempt.startedAt = new Date().toISOString();
  await writeExperimentRecord(experimentRecordPath(configuration), record);
  let evidenceCode = 0;
  try {
    const result = await runExternalProcess(
      harborProgramPath(),
      ["run", "--config", configurationPath],
      harborProcessEnvironment(record, attempt),
      configuration.limits.attemptTimeoutSeconds * 1000,
    );
    await writeFile(
      join(attemptDirectory, "harbor.log"),
      redactRuntimeSecrets(result.output + "\n" + result.errors),
    );
    const resultDirectory = result.timedOut
      ? null
      : await findHarborResult(join(attemptDirectory, "job"));
    if (result.timedOut) {
      evidenceCode = 3;
      attempt.error = "Harbor attempt exceeded its process deadline";
    } else if (!resultDirectory) {
      attempt.error = "Harbor did not produce a trial result";
    } else {
      const trial = validation.parse(
        harborResultSchema,
        JSON.parse(await readFile(join(resultDirectory, "result.json"), "utf8")),
      );
      evidenceCode = applyHarborTrial(attempt, trial, resultDirectory);
    }
  } catch (error) {
    attempt.error = redactRuntimeSecrets(
      error instanceof Error ? error.message : "Harbor execution failed",
    );
  }
  attempt.finishedAt = new Date().toISOString();
  attempt.durationSeconds = (Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt)) / 1000;
  await writeExperimentRecord(experimentRecordPath(configuration), record);
  return evidenceCode;
}
