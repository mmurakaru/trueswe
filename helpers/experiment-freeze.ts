import { readFile, writeFile, cp, mkdir, access } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprintDirectory } from "./directory-fingerprint.ts";
import { hashExperimentContent } from "./experiment-record.ts";
import type {
  ExperimentConfiguration,
  ExperimentRecord,
  FrozenExperimentInputs,
} from "./experiment-record.ts";
import { verifyTaskSnapshot } from "./task-snapshot.ts";
import { runExternalProcess } from "./child-process-io.ts";
import { requireEnvironmentVariable } from "./local-langfuse.ts";
import { harborProgramPath } from "./harbor-runtime.ts";
import { freezeManagedSkills, frozenSkillDirectory } from "./managed-skills.ts";

export function frozenTaskDirectory(
  configuration: ExperimentConfiguration,
  identifier: string,
): string {
  return resolve(configuration.outputDirectory, "frozen", "tasks", identifier, "task");
}
export function frozenInstructionPath(
  configuration: ExperimentConfiguration,
  name: string,
): string {
  return resolve(configuration.outputDirectory, "frozen", "instructions", `${name}.md`);
}

async function readRuntimeIdentity(): Promise<FrozenExperimentInputs["runtime"]> {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const harbor = await runExternalProcess(
    harborProgramPath(),
    ["--version"],
    { PATH: process.env.PATH, HOME: process.env.HOME },
    15_000,
  );
  if (harbor.status !== 0 || !harbor.output.trim())
    throw new Error("Harbor runtime version could not be resolved");
  if (harbor.output.match(/\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?/)?.[0] !== "0.25.0")
    throw new Error("Harbor 0.25.0 is required for the pinned result and error-policy format");
  const [helperContentHash, bendContentHash, packageLock] = await Promise.all([
    fingerprintDirectory(join(root, "helpers")),
    fingerprintDirectory(join(root, "src")),
    readFile(join(root, "package-lock.json")),
  ]);
  return {
    nodeVersion: process.version,
    bendVersion: requireEnvironmentVariable("TRUESWE_BEND_VERSION"),
    harborVersion: harbor.output.trim(),
    helperContentHash,
    bendContentHash,
    packageLockHash: hashExperimentContent(packageLock),
  };
}

export async function freezeExperimentInputs(
  configuration: ExperimentConfiguration,
): Promise<FrozenExperimentInputs> {
  const tasks = await Promise.all(
    configuration.tasks.map(async (task) => {
      const original = resolve(task.path);
      const snapshotDirectory = dirname(original);
      const hasSnapshot = await access(join(snapshotDirectory, "snapshot.json")).then(
        () => true,
        () => false,
      );
      const snapshot = hasSnapshot ? await verifyTaskSnapshot(snapshotDirectory) : null;
      if (snapshot && (snapshot.identifier !== task.identifier || snapshot.split !== task.split))
        throw new Error("Task snapshot identity or split does not match the experiment");
      const contentHash = await fingerprintDirectory(original);
      const destination = frozenTaskDirectory(configuration, task.identifier);
      await cp(original, destination, { recursive: true, verbatimSymlinks: true });
      if ((await fingerprintDirectory(destination)) !== contentHash)
        throw new Error(`Task changed while freezing: ${task.identifier}`);
      let snapshotHash: string | null = null;
      if (snapshot) {
        const content = await readFile(join(snapshotDirectory, "snapshot.json"));
        snapshotHash = hashExperimentContent(content);
        await writeFile(join(dirname(destination), "snapshot.json"), content);
        await cp(
          join(snapshotDirectory, "repository.tar"),
          join(dirname(destination), "repository.tar"),
        );
      }
      return {
        identifier: task.identifier,
        contentHash,
        snapshotHash,
        issueUrl: snapshot?.sourceIssue.url ?? null,
        startingCommit: snapshot?.startingCommit ?? null,
      };
    }),
  );
  await mkdir(resolve(configuration.outputDirectory, "frozen", "instructions"), {
    recursive: true,
  });
  const variants = await Promise.all(
    configuration.variants.map(async (variant) => {
      const instructionsContent = await readFile(resolve(variant.instructionsPath), "utf8");
      await writeFile(frozenInstructionPath(configuration, variant.name), instructionsContent);
      return {
        name: variant.name,
        instructionsHash: hashExperimentContent(instructionsContent),
        instructionsContent,
      };
    }),
  );
  return {
    tasks,
    variants,
    skills: await freezeManagedSkills(configuration),
    runtime: await readRuntimeIdentity(),
  };
}

export async function verifyFrozenExperimentInputs(record: ExperimentRecord): Promise<void> {
  if (record.inputHash !== hashExperimentContent(JSON.stringify(record.frozenInputs)))
    throw new Error("Frozen experiment input manifest changed");
  await Promise.all(
    record.frozenInputs.tasks.map(async (frozen) => {
      const task = record.configuration.tasks.find((item) => item.identifier === frozen.identifier);
      if (
        !task ||
        (await fingerprintDirectory(resolve(task.path))) !== frozen.contentHash ||
        (await fingerprintDirectory(
          frozenTaskDirectory(record.configuration, frozen.identifier),
        )) !== frozen.contentHash
      )
        throw new Error(`Frozen task input changed: ${frozen.identifier}`);
      if (frozen.snapshotHash) {
        const copies = [
          join(dirname(resolve(task.path)), "snapshot.json"),
          join(
            dirname(frozenTaskDirectory(record.configuration, frozen.identifier)),
            "snapshot.json",
          ),
        ];
        const hashes = await Promise.all(
          copies.map(async (path) => hashExperimentContent(await readFile(path))),
        );
        if (hashes.some((hash) => hash !== frozen.snapshotHash))
          throw new Error(`Frozen task metadata changed: ${frozen.identifier}`);
      }
    }),
  );
  await Promise.all(
    record.frozenInputs.variants.map(async (frozen) => {
      const variant = record.configuration.variants.find((item) => item.name === frozen.name);
      if (!variant || hashExperimentContent(frozen.instructionsContent) !== frozen.instructionsHash)
        throw new Error("Frozen instruction manifest changed");
      const contents = await Promise.all([
        readFile(resolve(variant.instructionsPath)),
        readFile(frozenInstructionPath(record.configuration, frozen.name)),
      ]);
      if (contents.some((content) => hashExperimentContent(content) !== frozen.instructionsHash))
        throw new Error(`Frozen instruction input changed: ${frozen.name}`);
    }),
  );
  if (JSON.stringify(await readRuntimeIdentity()) !== JSON.stringify(record.frozenInputs.runtime))
    throw new Error("Frozen execution runtime changed");
  await Promise.all(
    record.frozenInputs.skills.map(async (skill) => {
      if (
        (await fingerprintDirectory(
          frozenSkillDirectory(record.configuration, skill.variantName, skill.name),
        )) !== skill.contentHash
      )
        throw new Error(`Frozen skill input changed: ${skill.name}`);
    }),
  );
}
