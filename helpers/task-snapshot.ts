import * as validation from "valibot";
import { parse as parseToml } from "smol-toml";
import { readFile, writeFile, mkdir, mkdtemp, rename, rm, cp, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { runExternalProcess } from "./child-process-io.ts";
import { fingerprintDirectory } from "./directory-fingerprint.ts";
import { hashExperimentContent } from "./experiment-record.ts";

const commitIdentifier = validation.pipe(validation.string(), validation.regex(/^[0-9a-f]{40}$/));
const snapshotRequestSchema = validation.strictObject({
  schemaVersion: validation.literal(1),
  identifier: validation.pipe(validation.string(), validation.regex(/^[a-z][a-z0-9-]{0,63}$/)),
  repositoryDirectory: validation.string(),
  repositoryUrl: validation.pipe(
    validation.string(),
    validation.regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  ),
  startingCommit: commitIdentifier,
  prerequisiteCommits: validation.optional(validation.array(commitIdentifier), []),
  issueUrl: validation.pipe(
    validation.string(),
    validation.regex(
      /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/,
    ),
  ),
  taskTemplateDirectory: validation.string(),
  split: validation.picklist(["development", "reserved"]),
  previousEvaluationExposure: validation.string(),
  outputDirectory: validation.string(),
});
const sourceIssueSchema = validation.object({
  title: validation.string(),
  body: validation.string(),
  url: validation.string(),
  comments: validation.array(validation.object({ body: validation.string() })),
});
const verifierConfigurationSchema = validation.object({
  verifier: validation.object({ environment_mode: validation.literal("separate") }),
  artifacts: validation.pipe(
    validation.array(
      validation.union([validation.string(), validation.object({ source: validation.string() })]),
    ),
    validation.minLength(1),
  ),
});
export interface TaskSnapshot {
  schemaVersion: 1;
  identifier: string;
  split: "development" | "reserved";
  repositoryUrl: string;
  startingCommit: string;
  prerequisiteCommits: string[];
  sourceIssue: validation.InferOutput<typeof sourceIssueSchema>;
  sourceIssueHash: string;
  repositoryArchiveHash: string;
  taskContentHash: string;
  verifierContentHash: string;
  previousEvaluationExposure: string;
  createdAt: string;
}

const taskSnapshotSchema = validation.object({
  schemaVersion: validation.literal(1),
  identifier: validation.string(),
  split: validation.picklist(["development", "reserved"]),
  repositoryUrl: validation.string(),
  startingCommit: commitIdentifier,
  prerequisiteCommits: validation.array(commitIdentifier),
  sourceIssue: sourceIssueSchema,
  sourceIssueHash: validation.string(),
  repositoryArchiveHash: validation.string(),
  taskContentHash: validation.string(),
  verifierContentHash: validation.string(),
  previousEvaluationExposure: validation.string(),
  createdAt: validation.string(),
});

async function checkedSnapshotProcess(program: string, argumentsList: string[]): Promise<string> {
  const result = await runExternalProcess(program, argumentsList, process.env, 60_000);
  if (result.status !== 0)
    throw new Error(`Task snapshot command failed: ${program}: ${result.errors}`);
  return result.output;
}

export async function createTaskSnapshot(requestPath: string): Promise<TaskSnapshot> {
  const request = validation.parse(
    snapshotRequestSchema,
    JSON.parse(await readFile(requestPath, "utf8")),
  );
  const output = resolve(request.outputDirectory);
  if (
    await access(output).then(
      () => true,
      () => false,
    )
  )
    throw new Error("Task snapshot output already exists");
  const repository = resolve(request.repositoryDirectory);
  await checkedSnapshotProcess("git", [
    "-C",
    repository,
    "cat-file",
    "-e",
    `${request.startingCommit}^{commit}`,
  ]);
  await Promise.all(
    request.prerequisiteCommits.map((commit) =>
      checkedSnapshotProcess("git", [
        "-C",
        repository,
        "merge-base",
        "--is-ancestor",
        commit,
        request.startingCommit,
      ]),
    ),
  );
  const sourceIssue = validation.parse(
    sourceIssueSchema,
    JSON.parse(
      await checkedSnapshotProcess(process.env.TRUESWE_GITHUB ?? "gh", [
        "issue",
        "view",
        request.issueUrl,
        "--json",
        "title,body,url,comments",
      ]),
    ),
  );
  if (
    sourceIssue.url !== request.issueUrl ||
    !request.issueUrl.startsWith(request.repositoryUrl + "/issues/")
  )
    throw new Error("Task issue does not match its repository and source URL");
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(join(dirname(output), ".trueswe-snapshot-"));
  try {
    const taskPath = join(staging, "task");
    await cp(resolve(request.taskTemplateDirectory), taskPath, { recursive: true });
    validation.parse(
      verifierConfigurationSchema,
      parseToml(await readFile(join(taskPath, "task.toml"), "utf8")),
    );
    const archivePath = join(staging, "repository.tar");
    await checkedSnapshotProcess("git", [
      "-C",
      repository,
      "archive",
      "--format=tar",
      `--output=${archivePath}`,
      request.startingCommit,
    ]);
    const checkoutPath = join(taskPath, "environment", "repository");
    await mkdir(checkoutPath, { recursive: true });
    await checkedSnapshotProcess("tar", ["-xf", archivePath, "-C", checkoutPath]);
    const dockerfilePath = join(taskPath, "environment", "Dockerfile");
    const dockerfile = await readFile(dockerfilePath, "utf8");
    await writeFile(dockerfilePath, dockerfile + "\nWORKDIR /app\nCOPY repository/ /app/\n");
    await writeFile(
      join(taskPath, "instruction.md"),
      `# ${sourceIssue.title}\n\n${sourceIssue.body}\n\n## Source discussion\n\n${sourceIssue.comments.map((comment) => comment.body).join("\n\n")}\n`,
    );
    const snapshot: TaskSnapshot = {
      schemaVersion: 1,
      identifier: request.identifier,
      split: request.split,
      repositoryUrl: request.repositoryUrl,
      startingCommit: request.startingCommit,
      prerequisiteCommits: request.prerequisiteCommits,
      sourceIssue,
      sourceIssueHash: hashExperimentContent(JSON.stringify(sourceIssue)),
      repositoryArchiveHash: hashExperimentContent(await readFile(archivePath)),
      taskContentHash: await fingerprintDirectory(taskPath),
      verifierContentHash: await fingerprintDirectory(join(taskPath, "tests")),
      previousEvaluationExposure: request.previousEvaluationExposure,
      createdAt: new Date().toISOString(),
    };
    await writeFile(join(staging, "snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(staging, output);
    return snapshot;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function verifyTaskSnapshot(directory: string): Promise<TaskSnapshot> {
  const snapshot = validation.parse(
    taskSnapshotSchema,
    JSON.parse(await readFile(join(directory, "snapshot.json"), "utf8")),
  );
  const actual = await fingerprintDirectory(join(directory, "task"));
  if (actual !== snapshot.taskContentHash)
    throw new Error(`Frozen task content changed: ${snapshot.identifier}`);
  if (hashExperimentContent(JSON.stringify(snapshot.sourceIssue)) !== snapshot.sourceIssueHash)
    throw new Error(`Frozen issue content changed: ${snapshot.identifier}`);
  if (
    hashExperimentContent(await readFile(join(directory, "repository.tar"))) !==
    snapshot.repositoryArchiveHash
  )
    throw new Error(`Frozen repository archive changed: ${snapshot.identifier}`);
  if (
    (await fingerprintDirectory(join(directory, "task", "tests"))) !== snapshot.verifierContentHash
  )
    throw new Error(`Frozen verifier content changed: ${snapshot.identifier}`);
  return snapshot;
}
