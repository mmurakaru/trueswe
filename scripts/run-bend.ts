import { spawnSync } from "node:child_process";
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
const result = spawnSync(executablePath, argumentsList, {
  stdio: "inherit",
  env: {
    ...process.env,
    TRUESWE_ROOT: projectRoot,
    TRUESWE_BEND_VERSION: version.stdout.trim(),
    TRUESWE_BEND_SOURCE_HASH: sourceHash,
    BEND_NO_TELEMETRY: "1",
  },
});
if (result.error) console.error(`Bend launch failed: ${result.error.message}. Run npm run setup.`);
process.exit(result.status ?? 1);
