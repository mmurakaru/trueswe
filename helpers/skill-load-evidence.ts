import * as validation from "valibot";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { AttemptRecord, FrozenExperimentInputs } from "./experiment-record.ts";

const trajectorySchema = validation.object({
  steps: validation.array(
    validation.object({
      step_id: validation.union([validation.number(), validation.string()]),
      tool_calls: validation.optional(
        validation.array(
          validation.object({
            tool_call_id: validation.string(),
            function_name: validation.string(),
            arguments: validation.unknown(),
          }),
        ),
        [],
      ),
      observation: validation.optional(
        validation.nullable(
          validation.object({
            results: validation.array(
              validation.object({
                source_call_id: validation.nullable(validation.string()),
                content: validation.unknown(),
                extra: validation.optional(
                  validation.nullable(
                    validation.object({
                      tool_result_is_error: validation.optional(validation.boolean()),
                    }),
                  ),
                  null,
                ),
              }),
            ),
          }),
        ),
        null,
      ),
    }),
  ),
});
const fileReadArgumentsSchema = validation.union([
  validation.object({ path: validation.string() }),
  validation.object({ file_path: validation.string() }),
]);

export async function observeSkillLoads(
  trajectoryPath: string | null,
  skills: FrozenExperimentInputs["skills"],
): Promise<AttemptRecord["skillLoads"]> {
  if (!trajectoryPath || skills.length === 0) return [];
  let trajectory: unknown;
  try {
    trajectory = JSON.parse(await readFile(trajectoryPath, "utf8"));
  } catch {
    return [];
  }
  const parsed = validation.safeParse(trajectorySchema, trajectory);
  if (!parsed.success) return [];
  const loads: AttemptRecord["skillLoads"] = [];
  for (const step of parsed.output.steps)
    for (const call of step.tool_calls) {
      if (!["readFile", "Read", "skill_read"].includes(call.function_name)) continue;
      const argumentsResult = validation.safeParse(fileReadArgumentsSchema, call.arguments);
      if (!argumentsResult.success) continue;
      const result = step.observation?.results.find(
        (item) => item.source_call_id === call.tool_call_id,
      );
      if (
        !result ||
        result.extra?.tool_result_is_error !== false ||
        typeof result.content !== "string"
      )
        continue;
      const path =
        "path" in argumentsResult.output
          ? argumentsResult.output.path
          : argumentsResult.output.file_path;
      for (const skill of skills) {
        const roots = [
          `/app/.agents/skills/${skill.name}/`,
          `/app/.claude/skills/${skill.name}/`,
          `/app/.grok/skills/${skill.name}/`,
        ];
        const root = roots.find((candidate) => path.startsWith(candidate));
        if (!root) continue;
        const manifest = skill.files.find((file) => file.path === path.slice(root.length));
        if (
          !manifest ||
          createHash("sha256").update(result.content).digest("base64") !== manifest.sha256Hash
        )
          continue;
        loads.push({
          name: skill.name,
          version: skill.version,
          path,
          eventReference: `step:${step.step_id}/call:${call.tool_call_id}`,
        });
      }
    }
  return loads;
}
