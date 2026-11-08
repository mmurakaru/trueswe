import { spawn } from "node:child_process";

export async function launchExperimentCommand(
  argumentsList: string[],
  environment: NodeJS.ProcessEnv,
): Promise<{ status: number | null; output: string }> {
  const child = spawn(process.execPath, ["scripts/run-bend.ts", ...argumentsList], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (value: Buffer) => {
    output += value.toString();
  });
  child.stderr.on("data", (value: Buffer) => {
    output += value.toString();
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, output }));
  });
}
