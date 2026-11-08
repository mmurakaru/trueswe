import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, cp, rm, chmod, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { launchExperimentCommand } from "./command-test-support.ts";
import type { TaskSnapshot } from "../helpers/task-snapshot.ts";

test("snapshot CLI freezes committed source and issue evidence, then detects changes", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "trueswe-snapshot-test-"));
  try {
    const repository = join(temporaryDirectory, "repository");
    await mkdir(repository);
    execFileSync("git", ["init", "--quiet", repository]);
    await writeFile(join(repository, "content.txt"), "committed source");
    execFileSync("git", ["-C", repository, "add", "content.txt"]);
    execFileSync("git", [
      "-C",
      repository,
      "-c",
      "user.name=Test fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ]);
    const commit = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    await writeFile(join(repository, "content.txt"), "uncommitted edit");
    await writeFile(join(repository, ".env"), "private runtime input");
    const github = join(temporaryDirectory, "github-fixture");
    const issue = {
      title: "Build the fixture capability",
      body: "Make the public command work.",
      url: "https://github.com/example/project/issues/1",
      comments: [{ body: "Keep the output deterministic." }],
    };
    await writeFile(
      github,
      `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(issue))});\n`,
    );
    await chmod(github, 0o700);
    const template = join(temporaryDirectory, "template");
    await cp("tasks/smoke", template, { recursive: true });
    await mkdir(join(template, "environment", "required-empty"));
    await mkdir(join(template, "environment", "repository"), { recursive: true });
    await writeFile(
      join(template, "environment", "repository", "template-only.txt"),
      "not part of the commit",
    );
    const output = join(temporaryDirectory, "snapshot");
    const request = {
      schemaVersion: 1,
      identifier: "fixture-task",
      repositoryDirectory: repository,
      repositoryUrl: "https://github.com/example/project",
      startingCommit: commit,
      prerequisiteCommits: [commit],
      issueUrl: issue.url,
      taskTemplateDirectory: template,
      split: "reserved",
      previousEvaluationExposure: "No prior runs.",
      outputDirectory: output,
    };
    const requestPath = join(temporaryDirectory, "request.json");
    await writeFile(requestPath, JSON.stringify(request));
    const environment = { ...process.env, TRUESWE_GITHUB: github };
    const creation = await launchExperimentCommand(["snapshot", requestPath], environment);
    assert.equal(creation.status, 0, creation.output);
    const snapshot: TaskSnapshot = JSON.parse(
      await readFile(join(output, "snapshot.json"), "utf8"),
    );
    assert.equal(snapshot.startingCommit, commit);
    assert.equal(snapshot.split, "reserved");
    assert.equal(snapshot.sourceIssue.body, issue.body);
    assert.equal(
      await readFile(join(output, "task/environment/repository/content.txt"), "utf8"),
      "committed source",
    );
    assert.equal(
      await access(join(output, "task/environment/repository/.env")).then(
        () => true,
        () => false,
      ),
      false,
    );
    assert.equal(
      await access(join(output, "task/environment/repository/template-only.txt")).then(
        () => true,
        () => false,
      ),
      false,
    );
    const verification = await launchExperimentCommand(["verify-snapshot", output], environment);
    assert.equal(verification.status, 0, verification.output);
    await rm(join(output, "task/environment/required-empty"), { recursive: true });
    const missingDirectory = await launchExperimentCommand(
      ["verify-snapshot", output],
      environment,
    );
    assert.notEqual(missingDirectory.status, 0);
    assert.match(missingDirectory.output, /Frozen task content changed/);
    await mkdir(join(output, "task/environment/required-empty"));
    const overwrite = await launchExperimentCommand(["snapshot", requestPath], environment);
    assert.notEqual(overwrite.status, 0);
    assert.match(overwrite.output, /already exists/);
    await writeFile(join(output, "task/instruction.md"), "changed task");
    const changed = await launchExperimentCommand(["verify-snapshot", output], environment);
    assert.notEqual(changed.status, 0);
    assert.match(changed.output, /Frozen task content changed/);
    const invalidRequest = {
      ...request,
      prerequisiteCommits: ["f".repeat(40)],
      outputDirectory: join(temporaryDirectory, "invalid-prerequisite"),
    };
    await writeFile(requestPath, JSON.stringify(invalidRequest));
    const missingPrerequisite = await launchExperimentCommand(
      ["snapshot", requestPath],
      environment,
    );
    assert.notEqual(missingPrerequisite.status, 0);
    assert.equal(
      await access(invalidRequest.outputDirectory).then(
        () => true,
        () => false,
      ),
      false,
    );
    await writeFile(
      join(template, "task.toml"),
      (await readFile(join(template, "task.toml"), "utf8")).replace(
        'environment_mode = "separate"',
        'environment_mode = "shared"',
      ),
    );
    await writeFile(
      requestPath,
      JSON.stringify({ ...request, outputDirectory: join(temporaryDirectory, "shared-verifier") }),
    );
    const sharedVerifier = await launchExperimentCommand(["snapshot", requestPath], environment);
    assert.notEqual(sharedVerifier.status, 0);
    assert.match(sharedVerifier.output, /Invalid type/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
