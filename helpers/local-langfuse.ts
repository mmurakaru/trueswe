import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  setLangfuseTracerProvider,
  startObservation,
  LangfuseOtelSpanAttributes,
} from "@langfuse/tracing";
import { TracerProvider } from "@opentelemetry/sdk-trace";
import type {
  AttemptRecord,
  ExperimentConfiguration,
  FrozenExperimentInputs,
} from "./experiment-record.ts";

export function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable is missing: ${name}`);
  return value;
}

function localLangfuseAddress(configuration: Pick<ExperimentConfiguration, "langfuse">): string {
  const address = new URL(configuration.langfuse.baseUrl);
  if (address.username || address.password || address.search || address.hash)
    throw new Error("Langfuse address must not include credentials, a query, or a fragment");
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname) ||
    !["http:", "https:"].includes(address.protocol)
  )
    throw new Error("Langfuse must use a local loopback address");
  return address.href;
}

export function localLangfuseClient(configuration: Pick<ExperimentConfiguration, "langfuse">): LangfuseClient {
  return new LangfuseClient({
    baseUrl: localLangfuseAddress(configuration),
    publicKey: requireEnvironmentVariable("LANGFUSE_PUBLIC_KEY"),
    secretKey: requireEnvironmentVariable("LANGFUSE_SECRET_KEY"),
    timeout: 10,
  });
}

export async function checkLocalLangfuse(
  configuration: Pick<ExperimentConfiguration, "langfuse">,
): Promise<void> {
  const client = localLangfuseClient(configuration);
  const projects = await client.api.projects.get({}, { timeoutInSeconds: 10, maxRetries: 0 });
  if (!projects.data.some((project) => project.id === configuration.langfuse.projectIdentifier))
    throw new Error("Local Langfuse project does not match the experiment profile");
}

export async function recordLangfuseAttempt(
  configuration: ExperimentConfiguration,
  attempt: AttemptRecord,
  skills: FrozenExperimentInputs["skills"],
): Promise<string> {
  const processor = new LangfuseSpanProcessor({
    baseUrl: localLangfuseAddress(configuration),
    publicKey: requireEnvironmentVariable("LANGFUSE_PUBLIC_KEY"),
    secretKey: requireEnvironmentVariable("LANGFUSE_SECRET_KEY"),
    flushAt: 1,
    mediaUploadEnabled: false,
  });
  const provider = new TracerProvider({ spanProcessors: [processor] });
  setLangfuseTracerProvider(provider);
  try {
    const availability = JSON.stringify(skills.map(({ name, version }) => ({ name, version })));
    const observation = startObservation(
      `trueswe/${attempt.identifier}`,
      {
        input: {
          task: attempt.taskIdentifier,
          agent: attempt.agentName,
          variant: attempt.variantName,
          repetition: attempt.repetition,
        },
        output: { outcome: attempt.outcome, state: attempt.state },
        metadata: {
          experiment: configuration.name,
          trajectoryPath: attempt.trajectoryPath,
          durationSeconds: attempt.durationSeconds,
          inputTokens: attempt.inputTokens,
          outputTokens: attempt.outputTokens,
          costDollars: attempt.costDollars,
          skillLoadEvidence: attempt.skillLoadEvidence,
          skillLoads: attempt.skillLoads,
          skillSupply: skills.map(({ name, version, contentHash }) => ({
            name,
            version,
            contentHash,
          })),
          skillCatalogExposure: skills.length > 0 ? "unknown" : "not-supplied",
        },
      },
      { startTime: attempt.startedAt ? new Date(attempt.startedAt) : new Date() },
    );
    observation.otelSpan.setAttribute(
      LangfuseOtelSpanAttributes.OBSERVATION_SKILLS_AVAILABLE,
      availability,
    );
    for (const load of attempt.skillLoads) {
      const event = observation.startObservation(
        "skill_read",
        {
          input: { skillName: load.name, path: load.path.split(`/skills/${load.name}/`)[1] },
          output: { success: true },
          metadata: { eventReference: load.eventReference },
        },
        { asType: "tool" },
      );
      event.otelSpan.setAttribute(
        LangfuseOtelSpanAttributes.OBSERVATION_SKILLS_AVAILABLE,
        availability,
      );
      event.end();
    }
    const traceIdentifier = observation.traceId;
    observation.end(attempt.finishedAt ? new Date(attempt.finishedAt) : undefined);
    await provider.forceFlush();
    return traceIdentifier;
  } finally {
    await provider.shutdown();
    setLangfuseTracerProvider(null);
  }
}
