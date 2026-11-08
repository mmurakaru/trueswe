import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const compiler = process.env.TRUESWE_BEND ?? `${projectRoot}.tools/bend/bin/bend`;
const argumentsList = process.argv.slice(2);
const compilerArguments = argumentsList.includes("--check-only")
  ? [`${projectRoot}src/main.bend`, "--check-only"]
  : [`${projectRoot}src/main.bend`, "-o", `${projectRoot}.tools/trueswe`];
mkdirSync(`${projectRoot}.tools`, { recursive: true });
const compilation = spawnSync(compiler, compilerArguments, {
  stdio: "inherit",
  env: { ...process.env, BEND_NO_TELEMETRY: "1" },
});
if (compilation.status !== 0 || argumentsList.includes("--check-only"))
  process.exit(compilation.status ?? 1);
const result = spawnSync(`${projectRoot}.tools/trueswe`, argumentsList, {
  stdio: "inherit",
  env: { ...process.env, TRUESWE_ROOT: projectRoot, BEND_NO_TELEMETRY: "1" },
});
if (result.error) console.error(`Bend launch failed: ${result.error.message}. Run npm run setup.`);
process.exit(result.status ?? 1);
