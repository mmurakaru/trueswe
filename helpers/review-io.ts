import { withFileRecordLock } from "./file-record-lock.ts";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import * as validation from "valibot";
import {
  readExperimentConfiguration,
  readExperimentRecord,
  experimentRecordPath,
  hashExperimentContent,
} from "./experiment-record.ts";
import {
  reviewRequestSchema,
  labelRequestSchema,
  readReviewRecord,
  writeReviewRecord,
  reviewRecordPath,
  experimentReviews,
} from "./review-record.ts";
import type { ReviewRecord } from "./review-record.ts";
import { readReviewEvidence, registerCredentialFileValues } from "./review-evidence.ts";
import { requestJevJudgment } from "./jev-review.ts";
import { localLangfuseClient } from "./local-langfuse.ts";
import {
  redactRuntimeSecrets,
  registerCredentialEnvironmentReference,
} from "./secret-redaction.ts";
import { writeExperimentReport } from "./experiment-report.ts";

async function reviewContext(configurationPath: string, identifier: string) {
  const configuration = await readExperimentConfiguration(configurationPath);
  const record = await readExperimentRecord(experimentRecordPath(configuration));
  if (record.configurationHash !== hashExperimentContent(JSON.stringify(configuration)))
    throw new Error("Frozen experiment configuration changed");
  if (record.inputHash !== hashExperimentContent(JSON.stringify(record.frozenInputs)))
    throw new Error("Frozen input manifest changed");
  const attempt = record.attempts.find((item) => item.identifier === identifier);
  if (!attempt || ["pending", "running"].includes(attempt.state))
    throw new Error("Review requires a recorded terminal attempt");
  return { configuration, record, attempt, path: reviewRecordPath(record, identifier) };
}

async function boundReview(
  context: Awaited<ReturnType<typeof reviewContext>>,
): Promise<ReviewRecord> {
  const review = await readReviewRecord(context.path);
  if (
    review.executionNumber !== context.attempt.executionNumber ||
    review.experimentHash !== context.record.configurationHash ||
    review.attemptIdentifier !== context.attempt.identifier ||
    review.traceIdentifier !== context.attempt.traceIdentifier
  )
    throw new Error("Review does not match its experiment attempt and trace");
  return review;
}

async function existingReview(
  context: Awaited<ReturnType<typeof reviewContext>>,
): Promise<ReviewRecord | null> {
  try {
    return await boundReview(context);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function prepareAttemptReview(
  requestPath: string,
  identifier: string,
): Promise<number> {
  const request = validation.parse(
    reviewRequestSchema,
    JSON.parse(await readFile(requestPath, "utf8")),
  );
  const context = await reviewContext(
    request.experimentConfigurationPath,
    request.attemptIdentifier,
  );
  registerCredentialEnvironmentReference(request.keyEnvironment);
  const evidence = await readReviewEvidence(context.record, context.attempt);
  const judgment: ReviewRecord["judgments"][number] = {
    identifier: validation.parse(
      validation.pipe(validation.string(), validation.uuid()),
      identifier,
    ),
    status: "pending",
    requestedModel: request.model,
    keyEnvironment: request.keyEnvironment,
    modelIdentity: null,
    category: null,
    confidence: null,
    probabilities: null,
    submittedRequest: null,
    evidenceReferences: evidence.references,
    createdAt: new Date().toISOString(),
    error: null,
    exportError: null,
  };
  const confidence = await requestJevJudgment(
    judgment,
    evidence.state,
    request.keyEnvironment,
    evidence.trajectoryAvailable,
  );
  await withFileRecordLock(context.path, async () => {
    const review: ReviewRecord = (await existingReview(context)) ?? {
      schemaVersion: 1,
      executionNumber: context.attempt.executionNumber,
      experimentHash: context.record.configurationHash,
      attemptIdentifier: request.attemptIdentifier,
      traceIdentifier: context.attempt.traceIdentifier,
      createdAt: new Date().toISOString(),
      humanScoreIdentifier: randomUUID(),
      status: "pending",
      judgments: [],
      decision: null,
      decisions: [],
      exportError: null,
    };
    review.judgments.push(judgment);
    review.status = "pending";
    await writeReviewRecord(context.path, review);
  });
  return confidence;
}

export async function readReviewJudgmentKind(
  requestPath: string,
  identifier: string,
): Promise<string> {
  const request = validation.parse(
    reviewRequestSchema,
    JSON.parse(await readFile(requestPath, "utf8")),
  );
  const context = await reviewContext(
    request.experimentConfigurationPath,
    request.attemptIdentifier,
  );
  const review = await boundReview(context);
  const judgment = review.judgments.find((item) => item.identifier === identifier);
  if (!judgment) throw new Error("Review has no matching judgment");
  return judgment.error ? "request-error" : (judgment.category ?? "none");
}

export async function finalizeAttemptReview(
  requestPath: string,
  status: string,
  identifier: string,
): Promise<void> {
  const request = validation.parse(
    reviewRequestSchema,
    JSON.parse(await readFile(requestPath, "utf8")),
  );
  const context = await reviewContext(
    request.experimentConfigurationPath,
    request.attemptIdentifier,
  );
  await withFileRecordLock(context.path, async () => {
    const review = await boundReview(context);
    const judgment = review.judgments.find((item) => item.identifier === identifier);
    if (!judgment) throw new Error("Review has no matching judgment");
    judgment.status = validation.parse(validation.picklist(["suggested", "manual-review"]), status);
    if (review.judgments.at(-1)?.identifier === identifier) review.status = judgment.status;
    await writeReviewRecord(context.path, review);
    if (review.traceIdentifier) {
      try {
        const response = await localLangfuseClient(context.configuration).api.scores.create(
          [
            {
              id: judgment.identifier,
              traceId: review.traceIdentifier,
              name: "jev-review-category",
              value: judgment.category ?? "manual-review",
              dataType: "CATEGORICAL",
              timestamp: judgment.createdAt,
              comment: "Unconfirmed review suggestion",
              metadata: {
                status: judgment.status,
                confidence: judgment.confidence,
                model: judgment.modelIdentity,
                localReview: relative(resolve(context.configuration.outputDirectory), context.path),
                executionNumber: context.attempt.executionNumber,
              },
            },
          ],
          { timeoutInSeconds: 10, maxRetries: 0 },
        );
        if ("rejected" in response && response.rejected > 0)
          throw new Error("Langfuse rejected the review score");
      } catch {
        judgment.exportError =
          "Local Langfuse review export failed; the local judgment is preserved";
      }
    }
    await writeReviewRecord(context.path, review);
    await writeExperimentReport(context.record);
    console.log(
      `${request.attemptIdentifier}: ${judgment.status}.${judgment.error ? ` ${judgment.error}` : ""} No category is accepted without human confirmation.`,
    );
  });
}

export async function readHumanLabelAction(requestPath: string): Promise<string> {
  const request = validation.parse(
    labelRequestSchema,
    JSON.parse(await readFile(requestPath, "utf8")),
  );
  const context = await reviewContext(
    request.experimentConfigurationPath,
    request.attemptIdentifier,
  );
  const review = await boundReview(context);
  if (
    !review.judgments.some((judgment) =>
      judgment.evidenceReferences.includes(request.evidenceReference),
    )
  )
    throw new Error("Human label requires a recorded evidence reference");
  if (request.decision !== "reject" && !request.category)
    throw new Error("An accepted human label requires a review category");
  return request.decision;
}

export async function recordHumanLabel(requestPath: string, status: string): Promise<void> {
  await readHumanLabelAction(requestPath);
  const request = validation.parse(
    labelRequestSchema,
    JSON.parse(await readFile(requestPath, "utf8")),
  );
  const context = await reviewContext(
    request.experimentConfigurationPath,
    request.attemptIdentifier,
  );
  await withFileRecordLock(context.path, async () => {
    const review = await boundReview(context);
    await registerCredentialFileValues(context.record);
    for (const judgment of review.judgments)
      registerCredentialEnvironmentReference(judgment.keyEnvironment);
    if (status === "accepted" && !request.category)
      throw new Error("Accepted human labels require a category");
    const decision: NonNullable<ReviewRecord["decision"]> = {
      action: request.decision,
      status: validation.parse(validation.picklist(["accepted", "rejected"]), status),
      category: status === "accepted" ? (request.category ?? null) : null,
      evidenceReference: request.evidenceReference,
      explanation: redactRuntimeSecrets(request.explanation),
      confirmedAt: new Date().toISOString(),
    };
    review.decision = decision;
    review.decisions.push(decision);
    await writeReviewRecord(context.path, review);
    if (review.traceIdentifier) {
      try {
        const response = await localLangfuseClient(context.configuration).api.scores.create(
          [
            {
              id: review.humanScoreIdentifier,
              traceId: review.traceIdentifier,
              name: "human-review-decision",
              value: decision.category ?? "rejected",
              dataType: "CATEGORICAL",
              timestamp: review.createdAt,
              comment: decision.explanation,
              metadata: {
                action: decision.action,
                status: decision.status,
                evidenceReference: decision.evidenceReference,
                confirmedAt: decision.confirmedAt,
                localReview: relative(resolve(context.configuration.outputDirectory), context.path),
                executionNumber: context.attempt.executionNumber,
              },
            },
          ],
          { timeoutInSeconds: 10, maxRetries: 0 },
        );
        if ("rejected" in response && response.rejected > 0)
          throw new Error("Langfuse rejected the human review score");
        review.exportError = null;
      } catch {
        review.exportError =
          "Local Langfuse human review export failed; the local decision is preserved";
      }
    }
    await writeReviewRecord(context.path, review);
    await writeExperimentReport(context.record);
    console.log(`${request.attemptIdentifier}: human decision ${decision.status}.`);
  });
}

export async function listExperimentReviews(configurationPath: string): Promise<void> {
  const configuration = await readExperimentConfiguration(configurationPath);
  const record = await readExperimentRecord(experimentRecordPath(configuration));
  console.log(JSON.stringify(await experimentReviews(record), null, 2));
}
