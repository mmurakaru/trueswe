#!/usr/bin/env node
import { readFile, writeFile, mkdir, access, appendFile } from "node:fs/promises";
import { join } from "node:path";
if (process.argv.includes("--version")) {
  console.log("harbor, version 0.25.0");
  process.exit(0);
}
const configurationPath = process.argv[process.argv.indexOf("--config") + 1];
const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
if (
  configuration.agents[0].name === "grok-build" &&
  configuration.agents[0].kwargs.background_wait_sec < 1
)
  throw new Error("Grok background waiting must be positive");
const fixture = JSON.parse(await readFile(process.argv[1] + ".result.json", "utf8"));
for (const name of fixture.requiredEnvironmentNames ?? []) {
  if (!process.env[name]) throw new Error(`Required fixture environment is missing: ${name}`);
  console.log(process.env[name]);
}
for (const name of fixture.forbiddenEnvironmentNames ?? []) {
  if (process.env[name]) throw new Error(`Unexpected fixture environment was forwarded: ${name}`);
}
async function waitForRelease(path, remaining = 500) {
  if (
    await access(path).then(
      () => true,
      () => false,
    )
  )
    return;
  if (remaining === 0) throw new Error("Fixture release did not arrive");
  await new Promise((resolve) => setTimeout(resolve, 20));
  return waitForRelease(path, remaining - 1);
}
if (fixture.waitForFile && configuration.jobs_dir.endsWith("-2"))
  await waitForRelease(fixture.waitForFile);
if (fixture.invocationsPath)
  await appendFile(fixture.invocationsPath, configuration.jobs_dir + "\n");
if (fixture.pauseOnRepetition && configuration.jobs_dir.endsWith(`-${fixture.pauseOnRepetition}`)) {
  const trial = join(configuration.jobs_dir, configuration.job_name, "trial");
  await mkdir(join(trial, "agent"), { recursive: true });
  await writeFile(
    join(trial, "config.json"),
    JSON.stringify({ trial_name: "trial", task: { path: configuration.tasks[0].path } }),
  );
  await writeFile(
    join(trial, "agent", "trajectory.json"),
    JSON.stringify({
      steps: [{ step_id: 1, source: "agent", message: "Work before interruption" }],
    }),
  );
  if (fixture.writeResultBeforePause)
    await writeFile(join(trial, "result.json"), JSON.stringify(fixture));
  if (fixture.ignoreTermination) process.on("SIGTERM", () => {});
  await writeFile(fixture.readyPath, configuration.jobs_dir);
  await new Promise(() => {
    setInterval(() => {}, 1000);
  });
}
if (fixture.failOnRepetition && configuration.jobs_dir.endsWith(`-${fixture.failOnRepetition}`))
  fixture.verifier_result.rewards.reward = 0;
if (fixture.rewardByInstruction) {
  const instructions = await readFile(
    join(configuration.tasks[0].path, "environment", "AGENTS.md"),
    "utf8",
  );
  if (!(instructions in fixture.rewardByInstruction))
    throw new Error("Unknown project instructions supplied to the agent");
  fixture.verifier_result.rewards.reward = fixture.rewardByInstruction[instructions];
}
if (fixture.mutateInputPath)
  await writeFile(fixture.mutateInputPath, "changed input during the experiment");
if (fixture.interruptParent) {
  process.kill(process.ppid, "SIGTERM");
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}
if (configuration.agents[0].model_api_key_name)
  console.log(process.env[configuration.agents[0].model_api_key_name]);
const trial = join(configuration.jobs_dir, configuration.job_name, "trial");
await mkdir(join(trial, "agent"), { recursive: true });
await writeFile(join(trial, "config.json"), "{}");
await writeFile(join(trial, "result.json"), JSON.stringify(fixture));
await writeFile(
  join(trial, "agent", "trajectory.json"),
  JSON.stringify(fixture.trajectory ?? { steps: [] }),
);
