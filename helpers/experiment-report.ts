import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExperimentRecord } from "./experiment-record.ts";

export async function writeExperimentReport(record: ExperimentRecord): Promise<void> {
  const lines = [
    `# ${record.configuration.name}`,
    "",
    `Experiment: ${record.configurationHash}`,
    "",
    `${record.attempts.length} planned attempts.`,
    "",
  ];
  for (const attempt of record.attempts) {
    lines.push(
      `- ${attempt.identifier}: ${attempt.state}, ${attempt.outcome ?? "no verified outcome"}.`,
    );
    if (attempt.trajectoryPath) lines.push(`  [Trajectory](${attempt.trajectoryPath})`);
    if (attempt.traceIdentifier)
      lines.push(
        `  [Langfuse](${record.configuration.langfuse.baseUrl}/project/${record.configuration.langfuse.projectIdentifier}/traces/${attempt.traceIdentifier})`,
      );
    if (attempt.error) lines.push(`  ${attempt.error.replaceAll("\n", " ")}`);
    lines.push(
      `  Duration: ${attempt.durationSeconds ?? "unknown"} seconds. Input tokens: ${attempt.inputTokens ?? "unknown"}. Output tokens: ${attempt.outputTokens ?? "unknown"}. Cost: ${attempt.costDollars ?? "unknown"}.`,
    );
  }
  await writeFile(
    resolve(record.configuration.outputDirectory, "report.md"),
    lines.join("\n") + "\n",
  );
}
