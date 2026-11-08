import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export function startExperimentCommand(argumentsList: string[], environment: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, ["scripts/run-bend.ts", ...argumentsList], {
    env: {
      TRUESWE_DOCKER: fileURLToPath(new URL("fixtures/docker-fixture.mjs", import.meta.url)),
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (value: Buffer) => {
    output += value.toString();
  });
  child.stderr.on("data", (value: Buffer) => {
    output += value.toString();
  });
  const completion = new Promise<{ status: number | null; output: string }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, output }));
  });
  return { child, completion };
}

export async function launchExperimentCommand(
  argumentsList: string[],
  environment: NodeJS.ProcessEnv,
): Promise<{ status: number | null; output: string }> {
  return startExperimentCommand(argumentsList, environment).completion;
}
