import { writeFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import type { ExperimentRecord } from "./experiment-record.ts";
import { summarizeExperimentComparison } from "./comparison-summary.ts";

function skillLoadReport(attempt: ExperimentRecord["attempts"][number]): string[] {
  return [
    `  Skill loads: ${attempt.skillLoadEvidence}.`,
    ...attempt.skillLoads.map(
      (load) => `  ${load.name} version ${load.version}: ${load.eventReference}.`,
    ),
  ];
}

export async function writeExperimentReport(record: ExperimentRecord): Promise<void> {
  const lines = [
    `# ${record.configuration.name}`,
    "",
    `Experiment: ${record.configurationHash}`,
    "",
    `${record.attempts.length} planned attempts.`,
    "",
  ];
  for (const split of ["development", "reserved"] as const) {
    const rows = summarizeExperimentComparison(record).filter((row) => row.split === split);
    if (rows.length === 0) continue;
    lines.push(
      `## ${split === "development" ? "Development" : "Reserved evaluation"} results`,
      "",
      "| Task | Agent | Variant | Pass | Fail | Execution error | Interrupted | Pending | Verified pass rate |",
      "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const row of rows) {
      const verified = row.passed + row.failed;
      lines.push(
        `| ${row.taskIdentifier} | ${row.agentName} | ${row.variantName} | ${row.passed} | ${row.failed} | ${row.executionErrors} | ${row.interrupted} | ${row.pending} | ${verified ? `${row.passed}/${verified}` : "unknown"} |`,
      );
    }
    lines.push("");
  }
  lines.push(
    "Verified pass rates exclude execution errors and interruptions, which are listed separately.",
    "Three attempts provide an initial view of variation; small differences do not establish statistical reliability.",
    "The user decides whether to adopt the candidate.",
    "",
    "## Frozen inputs",
    "",
    `Input manifest: ${record.inputHash}`,
    `Runtime: Node ${record.frozenInputs.runtime.nodeVersion}, ${record.frozenInputs.runtime.bendVersion}, ${record.frozenInputs.runtime.harborVersion}.`,
    "",
  );
  for (const task of record.frozenInputs.tasks)
    lines.push(
      `- ${task.identifier}: ${task.contentHash}${task.startingCommit ? `, commit ${task.startingCommit}` : ""}.${task.issueUrl ? ` [Issue](${task.issueUrl})` : ""}`,
    );
  for (const variant of record.frozenInputs.variants)
    lines.push(
      `- [${variant.name} instructions](frozen/instructions/${variant.name}.md): ${variant.instructionsHash}.`,
    );
  lines.push("", "## Skills", "");
  for (const skill of record.frozenInputs.skills)
    lines.push(
      `- ${skill.variantName}: ${skill.name} version ${skill.version}, ${skill.contentHash}.`,
    );
  lines.push(
    "Project skill files are supplied to the agent discovery directory and verified during image construction.",
    "Agent catalog exposure is unknown without native evidence.",
    "A successful file read does not prove that the agent followed the skill.",
    "",
    "## Attempts",
    "",
  );
  for (const attempt of record.attempts) {
    lines.push(
      `- ${attempt.identifier}: ${attempt.state}, ${attempt.outcome ?? "no verified outcome"}.`,
    );
    if (attempt.trajectoryPath)
      lines.push(
        `  [Trajectory](${relative(resolve(record.configuration.outputDirectory), attempt.trajectoryPath)})`,
      );
    if (attempt.traceIdentifier)
      lines.push(
        `  [Langfuse](${record.configuration.langfuse.baseUrl}/project/${record.configuration.langfuse.projectIdentifier}/traces/${attempt.traceIdentifier})`,
      );
    if (attempt.error) lines.push(`  ${attempt.error.replaceAll("\n", " ")}`);
    lines.push(...skillLoadReport(attempt));
    lines.push(
      `  Duration: ${attempt.durationSeconds ?? "unknown"} seconds. Input tokens: ${attempt.inputTokens ?? "unknown"}. Output tokens: ${attempt.outputTokens ?? "unknown"}. Cost: ${attempt.costDollars ?? "unknown"}.`,
    );
  }
  await writeFile(
    resolve(record.configuration.outputDirectory, "report.md"),
    lines.join("\n") + "\n",
  );
}
