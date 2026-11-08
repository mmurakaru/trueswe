import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, cp, chmod, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { launchExperimentCommand } from "./command-test-support.ts";
import { startLocalLangfuseFixture } from "./local-langfuse-test-support.ts";
import { observeSkillLoads } from "../helpers/skill-load-evidence.ts";
import type { ExperimentRecord } from "../helpers/experiment-record.ts";

test("managed skill CLI publishes complete bundles, pins selectors and rejects mixed treatments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-skills-test-"));
  const langfuse = await startLocalLangfuseFixture();
  try {
    const skillDirectory = join(directory, "skill");
    await mkdir(skillDirectory);
    const source = "---\nname: test-skill\ndescription: Test skill\n---\nRead the task.\n";
    await writeFile(join(skillDirectory, "SKILL.md"), source);
    await writeFile(join(skillDirectory, "reference.md"), "Complete resource bundle");
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      TRUESWE_CODEX_AUTH_FILE: join(directory, "unused-auth.json"),
    };
    const requestPath = join(directory, "publish.json");
    const connection = { baseUrl: langfuse.baseUrl, projectIdentifier: "trueswe" };
    await writeFile(
      requestPath,
      JSON.stringify({
        schemaVersion: 1,
        skillDirectory,
        langfuse: connection,
        labels: ["benchmark"],
      }),
    );
    const publication = await launchExperimentCommand(["publish-skill", requestPath], environment);
    assert.equal(publication.status, 0, publication.output);
    assert.match(publication.output, /"version": 1/);
    await writeFile(join(skillDirectory, "LICENSE"), "Preserve this file");
    const unsupported = await launchExperimentCommand(["publish-skill", requestPath], environment);
    assert.notEqual(unsupported.status, 0);
    assert.match(unsupported.output, /unsupported.*LICENSE/);
    await rm(join(skillDirectory, "LICENSE"));
    await writeFile(
      join(skillDirectory, "SKILL.md"),
      source + "[Required guide](references/missing.md)\n",
    );
    const missing = await launchExperimentCommand(["publish-skill", requestPath], environment);
    assert.notEqual(missing.status, 0);
    assert.match(missing.output, /support file is missing/);
    await writeFile(join(skillDirectory, "SKILL.md"), source);
    await writeFile(join(skillDirectory, "run.sh"), "#!/bin/sh\necho skill\n", { mode: 0o755 });
    const executable = await launchExperimentCommand(["publish-skill", requestPath], environment);
    assert.notEqual(executable.status, 0);
    assert.match(executable.output, /cannot preserve executable permissions/);
    await rm(join(skillDirectory, "run.sh"));
    const helper = join(directory, "harbor-fixture");
    await cp("test/fixtures/harbor-fixture.mjs", helper);
    await chmod(helper, 0o700);
    await writeFile(
      helper + ".result.json",
      JSON.stringify({
        exception_info: null,
        verifier_environment_mode: "separate",
        verifier_result: { rewards: { reward: 1 } },
        agent_result: null,
        trajectory: {
          steps: [
            {
              step_id: 1,
              tool_calls: [
                {
                  tool_call_id: "read-1",
                  function_name: "Read",
                  arguments: { file_path: "/app/.agents/skills/test-skill/SKILL.md" },
                },
              ],
              observation: {
                results: [
                  {
                    source_call_id: "read-1",
                    content: source,
                    extra: { tool_result_is_error: false },
                  },
                ],
              },
            },
          ],
        },
      }),
    );
    environment.TRUESWE_HARBOR = helper;
    const configuration = JSON.parse(await readFile("examples/codex-smoke.json", "utf8"));
    configuration.name = "skill-comparison";
    configuration.outputDirectory = join(directory, "experiment");
    configuration.comparisonKind = "skills";
    configuration.langfuse = connection;
    configuration.variants = [
      { name: "baseline", instructionsPath: "examples/baseline-instructions.md" },
      {
        name: "candidate",
        instructionsPath: "examples/baseline-instructions.md",
        skills: [{ name: "test-skill", label: "benchmark" }],
      },
    ];
    const configurationPath = join(directory, "experiment.json");
    await writeFile(configurationPath, JSON.stringify(configuration));
    const execution = await launchExperimentCommand(["run", configurationPath], environment);
    assert.equal(execution.status, 0, execution.output);
    const record: ExperimentRecord = JSON.parse(
      await readFile(join(configuration.outputDirectory, "experiment.json"), "utf8"),
    );
    assert.equal(record.frozenInputs.skills[0]?.version, 1);
    assert.equal(record.frozenInputs.skills[0]?.files.length, 2);
    assert.equal(record.attempts[0]?.skillLoadEvidence, "not-supplied");
    assert.equal(record.attempts[1]?.skillLoadEvidence, "observed");
    const exported = langfuse.tracePayloads().join("\n");
    assert.match(exported, /langfuse\.observation\.skills_available/);
    assert.match(exported, /skillName/);
    assert.match(exported, /skill_read/);
    assert.equal(
      await readFile(
        join(configuration.outputDirectory, "frozen/skills/candidate/test-skill/reference.md"),
        "utf8",
      ),
      "Complete resource bundle",
    );
    const staged = await readFile(
      join(
        configuration.outputDirectory,
        "attempts/addition-codex-candidate-1/task/environment/Dockerfile",
      ),
      "utf8",
    );
    assert.match(staged, /COPY trueswe-skills\/ \/app\/\.agents\/skills\//);
    assert.match(staged, /sha256sum --check/);
    assert.equal(langfuse.skillSelections().length, 1);
    assert.match(langfuse.skillSelections()[0]!, /label=benchmark/);
    configuration.outputDirectory = join(directory, "mixed");
    configuration.variants[1].instructionsPath = "examples/candidate-instructions.md";
    await writeFile(configurationPath, JSON.stringify(configuration));
    const mixed = await launchExperimentCommand(["run", configurationPath], environment);
    assert.notEqual(mixed.status, 0);
    assert.match(mixed.output, /change only instructions or only skills/);
    const rejected: ExperimentRecord = JSON.parse(
      await readFile(join(configuration.outputDirectory, "experiment.json"), "utf8"),
    );
    assert.ok(rejected.attempts.every((attempt) => attempt.state === "pending"));
  } finally {
    await langfuse.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("skill evidence requires a matched successful read with exact content identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-skill-evidence-"));
  try {
    const path = join(directory, "trajectory.json");
    const content = "Complete skill content";
    const skills = [
      {
        variantName: "candidate",
        name: "test-skill",
        version: 3,
        contentHash: "bundle-hash",
        files: [
          { path: "SKILL.md", sha256Hash: createHash("sha256").update(content).digest("base64") },
        ],
      },
    ];
    const result = { source_call_id: "read-1", content, extra: { tool_result_is_error: false } };
    const trajectory = {
      steps: [
        {
          step_id: 1,
          tool_calls: [
            {
              tool_call_id: "read-1",
              function_name: "Read",
              arguments: { file_path: "/app/.claude/skills/test-skill/SKILL.md" },
            },
          ],
          observation: { results: [result] },
        },
      ],
    };
    await writeFile(path, JSON.stringify(trajectory));
    assert.equal((await observeSkillLoads(path, skills))[0]?.eventReference, "step:1/call:read-1");
    result.content = "Rendered or truncated content";
    await writeFile(path, JSON.stringify(trajectory));
    assert.deepEqual(await observeSkillLoads(path, skills), []);
    result.content = content;
    result.extra.tool_result_is_error = true;
    await writeFile(path, JSON.stringify(trajectory));
    assert.deepEqual(await observeSkillLoads(path, skills), []);
    trajectory.steps[0]!.tool_calls[0]!.function_name = "exec";
    result.extra.tool_result_is_error = false;
    await writeFile(path, JSON.stringify(trajectory));
    assert.deepEqual(await observeSkillLoads(path, skills), []);
    await writeFile(path, "not JSON");
    assert.deepEqual(await observeSkillLoads(path, skills), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
