import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, existsSync, rmSync } from "node:fs";

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
const executablePath = `${projectRoot}.tools/trueswe-${process.pid}`;
const compilerArguments = argumentsList.includes("--check-only")
  ? [`${projectRoot}src/main.bend`, "--check-only"]
  : [`${projectRoot}src/main.bend`, "-o", executablePath];
mkdirSync(`${projectRoot}.tools`, { recursive: true });
const compilation = spawnSync(compiler, compilerArguments, {
  stdio: "inherit",
  env: { ...process.env, BEND_NO_TELEMETRY: "1" },
});
if (compilation.error)
  console.error(`Bend compiler launch failed: ${compilation.error.message}. Run npm run setup.`);
if (compilation.status !== 0 || argumentsList.includes("--check-only"))
  process.exit(compilation.status ?? 1);
const result = spawnSync(executablePath, argumentsList, {
  stdio: "inherit",
  env: {
    ...process.env,
    TRUESWE_ROOT: projectRoot,
    TRUESWE_BEND_VERSION: version.stdout.trim(),
    BEND_NO_TELEMETRY: "1",
  },
});
rmSync(executablePath, { force: true });
if (result.error) console.error(`Bend launch failed: ${result.error.message}. Run npm run setup.`);
process.exit(result.status ?? 1);
