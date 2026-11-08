import { spawn, spawnSync } from "node:child_process";
import { readExperimentConfiguration } from "../helpers/experiment-record.ts";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { fingerprintDirectory } from "../helpers/directory-fingerprint.ts";
import { withFileRecordLock } from "../helpers/file-record-lock.ts";
import { mkdirSync, existsSync, rmSync, renameSync } from "node:fs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
if (existsSync(`${projectRoot}.env`)) process.loadEnvFile(`${projectRoot}.env`);
const compiler = process.env.TRUESWE_BEND ?? `${projectRoot}.tools/bend/bin/bend`;
const argumentsList = process.argv.slice(2);
const version = spawnSync(compiler, ["version"], {
  encoding: "utf8",
  env: { ...process.env, BEND_NO_TELEMETRY: "1" },
});
if (version.status !== 0) {
  console.error("Bend version could not be resolved. Run npm run setup.");
  process.exit(1);
}
const sourceHash = await fingerprintDirectory(`${projectRoot}src`);
const cacheHash = createHash("sha256")
  .update(JSON.stringify([projectRoot, compiler, version.stdout, sourceHash]))
  .digest("hex");
const executablePath = `${projectRoot}.tools/trueswe-${cacheHash}`;
mkdirSync(`${projectRoot}.tools`, { recursive: true });
if (argumentsList.includes("--check-only")) {
  const check = spawnSync(compiler, [`${projectRoot}src/main.bend`, "--check-only"], {
    stdio: "inherit",
    env: { ...process.env, BEND_NO_TELEMETRY: "1" },
  });
  if (check.error)
    console.error(`Bend compiler launch failed: ${check.error.message}. Run npm run setup.`);
  process.exit(check.status ?? 1);
}
await withFileRecordLock(executablePath, async () => {
  if (existsSync(executablePath)) return;
  const temporaryPath = `${executablePath}.${process.pid}.tmp`;
  try {
    const compilation = spawnSync(compiler, [`${projectRoot}src/main.bend`, "-o", temporaryPath], {
      stdio: "inherit",
      env: { ...process.env, BEND_NO_TELEMETRY: "1" },
    });
    if (compilation.error)
      throw new Error(
        `Bend compiler launch failed: ${compilation.error.message}. Run npm run setup.`,
      );
    if (compilation.status !== 0) throw new Error("Bend compilation failed");
    if ((await fingerprintDirectory(`${projectRoot}src`)) !== sourceHash)
      throw new Error("Bend source changed during compilation; run the command again");
    renameSync(temporaryPath, executablePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
});
const nativeEnvironment = {
  ...process.env,
  TRUESWE_ROOT: projectRoot,
  TRUESWE_BEND_VERSION: version.stdout.trim(),
  TRUESWE_BEND_SOURCE_HASH: sourceHash,
  BEND_NO_TELEMETRY: "1",
};
let receivedSignal: NodeJS.Signals | null = null;
async function launchNative(nativeArguments: string[], forwardSignals: boolean): Promise<number> {
  return new Promise((complete, reject) => {
    const child = spawn(executablePath, nativeArguments, {
      stdio: "inherit",
      env: nativeEnvironment,
      detached: true,
    });
    let killTimer: NodeJS.Timeout | undefined;
    const escalation = Promise.withResolvers<void>();
    const stop = (signal: NodeJS.Signals) => {
      receivedSignal = signal;
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        return;
      }
      killTimer ??= setTimeout(() => {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          /* The native process group has exited. */
        }
        escalation.resolve();
      }, 8000);
    };
    const interrupt = () => stop("SIGINT");
    const terminate = () => stop("SIGTERM");
    if (forwardSignals) {
      process.on("SIGINT", interrupt);
      process.on("SIGTERM", terminate);
    }
    const cleanup = () => {
      clearTimeout(killTimer);
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", terminate);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", async (status) => {
      if (killTimer) await escalation.promise;
      cleanup();
      complete(status ?? 1);
    });
  });
}
async function runCommand(): Promise<number> {
  const status = await launchNative(argumentsList, true);
  if (receivedSignal && argumentsList[1]) {
    console.error("Preserving interrupted experiment evidence.");
    await launchNative(["recover", argumentsList[1]], false);
    return receivedSignal === "SIGINT" ? 130 : 143;
  }
  return status;
}
try {
  if (["run", "resume", "recover"].includes(argumentsList[0] ?? "") && argumentsList[1]) {
    const configuration = await readExperimentConfiguration(argumentsList[1]);
    process.exitCode = await withFileRecordLock(
      `${resolve(configuration.outputDirectory)}.operation`,
      runCommand,
      false,
    );
  } else process.exitCode = await launchNative(argumentsList, true);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
}
