import { mkdir, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExperimentRecord, AttemptRecord } from "./experiment-record.ts";
import { frozenSkillDirectory } from "./managed-skills.ts";

const nativeProjectSkillDirectories = new Map([
  ["codex", "/app/.agents/skills"],
  ["claude-code", "/app/.claude/skills"],
  ["grok-build", "/app/.grok/skills"],
]);

export async function stageAttemptSkills(
  record: ExperimentRecord,
  attempt: AttemptRecord,
  taskDirectory: string,
): Promise<void> {
  const destination = nativeProjectSkillDirectories.get(attempt.agentName);
  if (!destination) throw new Error("Agent has no supported project skill discovery path");
  const selected = record.frozenInputs.skills.filter(
    (skill) => skill.variantName === attempt.variantName,
  );
  const context = join(taskDirectory, "environment");
  const staged = join(context, "trueswe-skills");
  await mkdir(staged, { recursive: true });
  await Promise.all(
    selected.map((skill) =>
      cp(
        frozenSkillDirectory(record.configuration, attempt.variantName, skill.name),
        join(staged, skill.name),
        { recursive: true },
      ),
    ),
  );
  const checksums = selected.flatMap((skill) =>
    skill.files.map(
      (file) =>
        `${Buffer.from(file.sha256Hash, "base64").toString("hex")}  ${skill.name}/${file.path}`,
    ),
  );
  await writeFile(join(context, "trueswe-skill-checksums.txt"), checksums.join("\n") + "\n");
  const dockerfile = join(context, "Dockerfile");
  const existing = await readFile(dockerfile, "utf8");
  const cleanDirectories = "RUN rm -rf /app/.agents /app/.claude /app/.codex /app/.grok\n";
  const supply =
    selected.length > 0
      ? `COPY trueswe-skills/ ${destination}/\nCOPY trueswe-skill-checksums.txt /tmp/trueswe-skill-checksums.txt\nRUN cd ${destination} && sha256sum --check /tmp/trueswe-skill-checksums.txt\n`
      : "";
  await writeFile(dockerfile, `${existing}\nWORKDIR /app\n${cleanDirectories}${supply}`);
}
