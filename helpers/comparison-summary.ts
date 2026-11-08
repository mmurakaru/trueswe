import type { AttemptRecord, ExperimentRecord } from "./experiment-record.ts";

export interface ComparisonRow {
  taskIdentifier: string;
  split: "development" | "reserved";
  agentName: string;
  variantName: string;
  passed: number;
  failed: number;
  executionErrors: number;
  interrupted: number;
  pending: number;
}

function countComparisonAttempts(
  attempts: AttemptRecord[],
): Omit<ComparisonRow, "taskIdentifier" | "split" | "agentName" | "variantName"> {
  return {
    passed: attempts.filter(
      (attempt) => attempt.state === "completed" && attempt.outcome === "pass",
    ).length,
    failed: attempts.filter(
      (attempt) => attempt.state === "completed" && attempt.outcome === "fail",
    ).length,
    executionErrors: attempts.filter((attempt) => attempt.state === "execution-error").length,
    interrupted: attempts.filter((attempt) => attempt.state === "interrupted").length,
    pending: attempts.filter(
      (attempt) => attempt.state === "pending" || attempt.state === "running",
    ).length,
  };
}

export function summarizeExperimentComparison(record: ExperimentRecord): ComparisonRow[] {
  return record.configuration.tasks.flatMap((task) =>
    record.configuration.agents.flatMap((agent) =>
      record.configuration.variants.map((variant) => ({
        taskIdentifier: task.identifier,
        split: task.split,
        agentName: agent.name,
        variantName: variant.name,
        ...countComparisonAttempts(
          record.attempts.filter(
            (attempt) =>
              attempt.taskIdentifier === task.identifier &&
              attempt.agentName === agent.name &&
              attempt.variantName === variant.name,
          ),
        ),
      })),
    ),
  );
}
