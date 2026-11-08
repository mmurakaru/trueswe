import type { JsonValue } from "@typesafe-ai/sdk";
import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import * as validation from "valibot";
import { reviewCategories } from "./review-record.ts";
import type { ReviewRecord } from "./review-record.ts";
import {
  registerCredentialEnvironmentReference,
  redactRuntimeSecrets,
} from "./secret-redaction.ts";

export const reviewQuestion = choice(
  "Which review category best describes the recorded task attempt?",
  {
    "tool-failure":
      "A tool or runtime malfunction demonstrably prevented progress. A failed command alone is insufficient evidence.",
    "wrong-path":
      "The agent pursued an approach inconsistent with the task or recorded repository evidence.",
    "missing-context": "Required information was absent from the context available to the agent.",
    "task-misunderstanding": "The agent interpreted the requested behavior incorrectly.",
    none: "No category is supported by the available evidence, or the evidence is insufficient to judge.",
  },
);

const probability = validation.pipe(
  validation.number(),
  validation.minValue(0),
  validation.maxValue(1),
);
const answerSchema = validation.object({
  model: validation.pipe(validation.string(), validation.minLength(1), validation.maxLength(200)),
  answers: validation.object({
    reviewCategory: validation.object({
      type: validation.literal("choice"),
      choice: validation.picklist([...reviewCategories, "none"]),
      confidence: probability,
      probabilities: validation.record(
        validation.picklist([...reviewCategories, "none"]),
        probability,
      ),
    }),
  }),
});

function typesafeAddress(): string {
  const address = new URL(process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(address.hostname);
  if (
    address.username ||
    address.password ||
    address.search ||
    address.hash ||
    (!local && address.origin !== "https://api.typesafe.ai") ||
    !["http:", "https:"].includes(address.protocol)
  )
    throw new Error("TypeSafe must use the official HTTPS endpoint or a local test endpoint");
  return address.href;
}

export async function requestJevJudgment(
  judgment: ReviewRecord["judgments"][number],
  state: Record<string, JsonValue>,
  keyEnvironment: string,
  trajectoryAvailable: boolean,
): Promise<number> {
  registerCredentialEnvironmentReference(keyEnvironment);
  const request = {
    model: judgment.requestedModel,
    state,
    questions: { reviewCategory: reviewQuestion },
  };
  judgment.submittedRequest = { endpoint: "unresolved", request };
  try {
    const endpoint = typesafeAddress();
    judgment.submittedRequest = { endpoint, request };
    if (!trajectoryAvailable)
      throw new Error("Recorded trajectory evidence is unavailable; manual review is required");
    if (!process.env[keyEnvironment])
      throw new Error(`TypeSafe credential reference is unavailable: ${keyEnvironment}`);
    if (Buffer.byteLength(JSON.stringify(request)) > 32_000)
      throw new Error("Review evidence exceeds the 32000-byte request limit");
    const client = new TypeSafeClient({
      apiKey: process.env[keyEnvironment],
      baseURL: endpoint,
      timeout: 15_000,
      retry: { maxRetries: 0 },
      logLevel: "off",
      compression: false,
    });
    const result = validation.parse(answerSchema, await client.systemOne(request));
    const answer = result.answers.reviewCategory;
    if (
      ![...reviewCategories, "none"].every((category) =>
        Object.hasOwn(answer.probabilities, category),
      ) ||
      Math.abs(Object.values(answer.probabilities).reduce((total, value) => total + value, 0) - 1) >
        0.001
    )
      throw new Error("TypeSafe returned an incomplete probability distribution");
    judgment.modelIdentity = redactRuntimeSecrets(result.model);
    judgment.category = answer.choice;
    judgment.confidence = answer.confidence;
    judgment.probabilities = answer.probabilities;
    return Math.floor(answer.confidence * 10_000);
  } catch (error) {
    judgment.error = redactRuntimeSecrets(
      error instanceof Error ? error.message : "TypeSafe review request failed",
    ).slice(0, 1000);
    return 0;
  }
}
