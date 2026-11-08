import * as validation from "valibot";
import { readFile, writeFile, mkdir, rename, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { ExperimentRecord } from "./experiment-record.ts";

const identifierSchema = validation.pipe(
  validation.string(),
  validation.regex(/^[a-z0-9-]+$/),
  validation.maxLength(220),
);
const nonemptyText = validation.pipe(
  validation.string(),
  validation.minLength(1),
  validation.maxLength(2000),
);
export const reviewCategories = [
  "tool-failure",
  "wrong-path",
  "missing-context",
  "task-misunderstanding",
] as const;
export const reviewCategorySchema = validation.picklist(reviewCategories);
export const reviewRequestSchema = validation.strictObject({
  schemaVersion: validation.literal(1),
  experimentConfigurationPath: validation.string(),
  attemptIdentifier: identifierSchema,
  model: validation.pipe(validation.string(), validation.minLength(1), validation.maxLength(200)),
  keyEnvironment: validation.optional(
    validation.pipe(validation.string(), validation.regex(/^[A-Z][A-Z0-9_]*$/)),
    "TYPESAFE_API_KEY",
  ),
});
export const labelRequestSchema = validation.strictObject({
  schemaVersion: validation.literal(1),
  experimentConfigurationPath: validation.string(),
  attemptIdentifier: identifierSchema,
  decision: validation.picklist(["accept", "change", "reject"]),
  category: validation.optional(reviewCategorySchema),
  evidenceReference: nonemptyText,
  explanation: nonemptyText,
});
const confidenceSchema = validation.pipe(
  validation.number(),
  validation.minValue(0),
  validation.maxValue(1),
);
const humanDecisionSchema = validation.object({
  action: validation.picklist(["accept", "change", "reject"]),
  status: validation.picklist(["accepted", "rejected"]),
  category: validation.nullable(reviewCategorySchema),
  evidenceReference: nonemptyText,
  explanation: nonemptyText,
  confirmedAt: validation.string(),
});
const judgmentSchema = validation.object({
  identifier: validation.string(),
  requestedModel: validation.string(),
  keyEnvironment: validation.string(),
  modelIdentity: validation.nullable(validation.string()),
  category: validation.nullable(validation.picklist([...reviewCategories, "none"])),
  confidence: validation.nullable(confidenceSchema),
  probabilities: validation.nullable(validation.record(validation.string(), confidenceSchema)),
  submittedRequest: validation.unknown(),
  evidenceReferences: validation.array(validation.string()),
  createdAt: validation.string(),
  error: validation.nullable(validation.string()),
  exportError: validation.nullable(validation.string()),
});
export const reviewRecordSchema = validation.object({
  schemaVersion: validation.literal(1),
  experimentHash: validation.string(),
  attemptIdentifier: identifierSchema,
  traceIdentifier: validation.nullable(validation.string()),
  createdAt: validation.string(),
  humanScoreIdentifier: validation.string(),
  status: validation.picklist(["pending", "suggested", "manual-review"]),
  judgments: validation.array(judgmentSchema),
  decision: validation.nullable(humanDecisionSchema),
  decisions: validation.array(humanDecisionSchema),
  exportError: validation.nullable(validation.string()),
});
export type ReviewRecord = validation.InferOutput<typeof reviewRecordSchema>;

export function reviewRecordPath(record: ExperimentRecord, identifier: string): string {
  validation.parse(identifierSchema, identifier);
  return resolve(record.configuration.outputDirectory, "reviews", `${identifier}.json`);
}

export async function readReviewRecord(path: string): Promise<ReviewRecord> {
  return validation.parse(reviewRecordSchema, JSON.parse(await readFile(path, "utf8")));
}

export async function writeReviewRecord(path: string, record: ReviewRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, path);
}

export async function experimentReviews(record: ExperimentRecord): Promise<ReviewRecord[]> {
  const rows = await Promise.all(
    record.attempts.map(async (attempt) => {
      const path = reviewRecordPath(record, attempt.identifier);
      if (
        !(await access(path).then(
          () => true,
          () => false,
        ))
      )
        return null;
      const review = await readReviewRecord(path);
      if (
        review.experimentHash !== record.configurationHash ||
        review.attemptIdentifier !== attempt.identifier
      )
        throw new Error("Review does not match its frozen experiment attempt");
      return review;
    }),
  );
  return rows.filter((row) => row !== null);
}
