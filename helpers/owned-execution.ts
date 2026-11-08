import { readFile, writeFile, readdir, mkdir, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import * as validation from "valibot";
import { runExternalProcess } from "./child-process-io.ts";

const ownerSchema = validation.object({
  processIdentifier: validation.pipe(
    validation.number(),
    validation.integer(),
    validation.minValue(1),
  ),
  token: validation.pipe(validation.string(), validation.uuid()),
});
const trialSchema = validation.object({
  trial_name: validation.string(),
  task: validation.object({ path: validation.string() }),
});

export function localProcessEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_CONFIG",
    "SSL_CERT_FILE",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
  ])
    if (process.env[name]) environment[name] = process.env[name];
  return environment;
}

export function createExecutionOwner(directory: string): {
  token: string;
  save: (processIdentifier: number) => Promise<void>;
} {
  const token = randomUUID();
  return {
    token,
    save: (processIdentifier) =>
      writeFile(
        join(directory, "harbor-process.json"),
        JSON.stringify({ processIdentifier, token }) + "\n",
        { mode: 0o600, flag: "wx" },
      ),
  };
}

async function ownedProcessGroupExists(processIdentifier: number, token: string): Promise<boolean> {
  const processes = await runExternalProcess(
    "ps",
    ["-axo", "pid=,pgid="],
    localProcessEnvironment(),
    5000,
  );
  if (processes.status !== 0) throw new Error("Owned process groups could not be inspected");
  const members = processes.output
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => Number(fields[1]) === processIdentifier)
    .map((fields) => fields[0])
    .filter((identifier) => identifier && /^\d+$/.test(identifier));
  const checks = await Promise.all(
    members.map(async (identifier) => {
      const result = await runExternalProcess(
        "ps",
        ["eww", "-p", identifier!, "-o", "command="],
        localProcessEnvironment(),
        5000,
      );
      return (
        result.status === 0 &&
        new RegExp(`(?:^|\\s)TRUESWE_EXECUTION_TOKEN=${token}(?:\\s|$)`).test(result.output)
      );
    }),
  );
  return checks.some(Boolean);
}

export async function stopOwnedExecution(directory: string): Promise<void> {
  const path = join(directory, "harbor-process.json");
  if (
    !(await access(path).then(
      () => true,
      () => false,
    ))
  )
    return;
  const owner = validation.parse(ownerSchema, JSON.parse(await readFile(path, "utf8")));
  if (!(await ownedProcessGroupExists(owner.processIdentifier, owner.token))) return;
  try {
    process.kill(-owner.processIdentifier, "SIGTERM");
  } catch {
    return;
  }
  await new Promise((complete) => setTimeout(complete, 2100));
  if (await ownedProcessGroupExists(owner.processIdentifier, owner.token)) {
    try {
      process.kill(-owner.processIdentifier, "SIGKILL");
    } catch {
      return;
    }
  }
}

async function ownedTrialPrefixes(directory: string): Promise<string[]> {
  const job = join(directory, "job");
  const entries = await readdir(job, { withFileTypes: true }).catch(() => []);
  const prefixes = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const parsed = validation.safeParse(
          trialSchema,
          JSON.parse(
            await readFile(join(job, entry.name, "config.json"), "utf8").catch(() => "null"),
          ),
        );
        if (
          !parsed.success ||
          parsed.output.trial_name !== entry.name ||
          resolve(parsed.output.task.path) !== resolve(directory, "task")
        )
          return null;
        return parsed.output.trial_name
          .toLowerCase()
          .replace(/^[^a-z0-9]/, "0$&")
          .replace(/[^a-z0-9_-]/g, "-");
      }),
  );
  return prefixes.filter((prefix) => prefix !== null);
}

export async function cleanupOwnedTaskResources(directory: string): Promise<string[]> {
  const warnings: string[] = [];
  const deadline = Date.now() + 25_000;
  const docker = async (argumentsList: string[]) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Owned Docker cleanup exceeded its deadline");
    return runExternalProcess(
      process.env.TRUESWE_DOCKER ?? "docker",
      argumentsList,
      localProcessEnvironment(),
      Math.min(5000, remaining),
    );
  };
  try {
    const folders = [join(directory, "task/environment"), join(directory, "task/tests")];
    const groups = await Promise.all(
      folders.map(async (folder) => {
        const result = await docker([
          "ps",
          "--all",
          "--quiet",
          "--filter",
          `label=com.docker.compose.project.working_dir=${resolve(folder)}`,
        ]);
        if (result.status !== 0) throw new Error("Owned Docker containers could not be inspected");
        return result.output
          .split(/\s+/)
          .filter((identifier) => /^[a-f0-9]{12,64}$/.test(identifier));
      }),
    );
    const containers = [...new Set(groups.flat())];
    if (containers.length > 0) {
      const destination = join(directory, "interrupted-agent");
      await mkdir(destination, { recursive: true, mode: 0o700 });
      await Promise.all(
        containers.map((identifier) =>
          docker(["cp", `${identifier}:/logs/agent/.`, join(destination, identifier)]),
        ),
      );
      if ((await docker(["container", "rm", "--force", ...containers])).status !== 0)
        warnings.push("Owned Docker containers could not all be removed");
    }
    const prefixes = await ownedTrialPrefixes(directory);
    if (prefixes.length > 0) {
      const result = await docker([
        "network",
        "ls",
        "--filter",
        "label=com.docker.compose.project",
        "--format",
        '{{.ID}} {{.Label "com.docker.compose.project"}}',
      ]);
      if (result.status !== 0) throw new Error("Owned Docker networks could not be inspected");
      const networks = result.output
        .split("\n")
        .map((line) => line.trim().split(/\s+/))
        .filter(
          ([identifier, project]) =>
            identifier &&
            /^[a-f0-9]{12,64}$/.test(identifier) &&
            project &&
            prefixes.some(
              (prefix) =>
                project === `${prefix}__env` || project.startsWith(`${prefix}__verifier__`),
            ),
        )
        .map(([identifier]) => identifier!);
      if (networks.length > 0 && (await docker(["network", "rm", ...networks])).status !== 0)
        warnings.push("Owned Docker networks could not all be removed");
    }
  } catch {
    warnings.push(
      "Owned task resource cleanup could not be completed; inspect this execution before resuming",
    );
  }
  return warnings;
}
