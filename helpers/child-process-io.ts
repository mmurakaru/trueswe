import { spawn } from "node:child_process";

export interface ExternalProcessResult {
  status: number;
  output: string;
  errors: string;
  timedOut: boolean;
}
export async function runExternalProcess(
  program: string,
  argumentsList: string[],
  environment: NodeJS.ProcessEnv,
  timeoutMilliseconds: number,
): Promise<ExternalProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, argumentsList, {
      env: environment,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    let timedOut = false;
    let outputExceeded = false;
    const terminate = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* The process group has already exited. */
        }
      }
    };
    const forceTerminate = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* The process group has already exited. */
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMilliseconds);
    const killTimer = setTimeout(forceTerminate, timeoutMilliseconds + 2000);
    const onSignal = () => {
      timedOut = true;
      terminate();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length + errors.length > 1_000_000) {
        outputExceeded = true;
        forceTerminate();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors += chunk.toString();
      if (output.length + errors.length > 1_000_000) {
        outputExceeded = true;
        forceTerminate();
      }
    });
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      process.removeListener("SIGINT", onSignal);
      process.removeListener("SIGTERM", onSignal);
    };
    child.once("error", (error) => {
      cleanup();
      reject(error);
    });
    child.once("close", (status) => {
      cleanup();
      resolve({
        status: outputExceeded ? 1 : (status ?? 1),
        output: output.slice(0, 1_000_000),
        errors: outputExceeded
          ? "External process output limit exceeded"
          : errors.slice(0, 1_000_000),
        timedOut,
      });
    });
  });
}
