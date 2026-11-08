import { readFile } from "node:fs/promises";
import { redactRuntimeSecrets } from "./secret-redaction.ts";

try {
  if (process.argv[2] === "version") {
    const manifest: { version: string } = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    console.log(`trueswe ${manifest.version}`);
  } else if (process.argv[2] === "prepare" && process.argv[3]) {
    const { prepareExperiment } = await import("./experiment-io.ts");
    process.stdout.write(String(await prepareExperiment(process.argv[3])));
  } else if (process.argv[2] === "attempt" && process.argv[3] && process.argv[4]) {
    const { executeExperimentOrdinal } = await import("./experiment-io.ts");
    process.stdout.write(
      String(await executeExperimentOrdinal(process.argv[3], Number(process.argv[4]))),
    );
  } else if (
    process.argv[2] === "finalize" &&
    process.argv[3] &&
    process.argv[4] &&
    process.argv[5] &&
    process.argv[6]
  ) {
    const { finalizeExperimentOrdinal } = await import("./experiment-io.ts");
    await finalizeExperimentOrdinal(
      process.argv[3],
      Number(process.argv[4]),
      process.argv[5],
      process.argv[6],
    );
  } else if (process.argv[2] === "plan" && process.argv[3]) {
    const { readExperimentConfiguration } = await import("./experiment-record.ts");
    const configuration = await readExperimentConfiguration(process.argv[3]);
    console.log(
      JSON.stringify(
        {
          name: configuration.name,
          attempts:
            configuration.tasks.length *
            configuration.agents.length *
            configuration.variants.length *
            configuration.repetitions,
          limits: configuration.limits,
          agents: configuration.agents.map((agent) => ({
            name: agent.name,
            model: agent.model,
            version: agent.version,
          })),
        },
        null,
        2,
      ),
    );
  } else if (process.argv[2] === "exception" && process.argv[3] && process.argv[4]) {
    const { readExperimentConfiguration, readExperimentRecord, experimentRecordPath } =
      await import("./experiment-record.ts");
    const configuration = await readExperimentConfiguration(process.argv[3]);
    const record = await readExperimentRecord(experimentRecordPath(configuration));
    const attempt = record.attempts[Number(process.argv[4])];
    if (!attempt) throw new Error("Attempt is absent");
    process.stdout.write(attempt.exceptionType ?? "");
  } else if (process.argv[2] === "snapshot" && process.argv[3]) {
    const { createTaskSnapshot } = await import("./task-snapshot.ts");
    const snapshot = await createTaskSnapshot(process.argv[3]);
    console.log(
      JSON.stringify(
        {
          identifier: snapshot.identifier,
          split: snapshot.split,
          taskContentHash: snapshot.taskContentHash,
        },
        null,
        2,
      ),
    );
  } else if (process.argv[2] === "verify-snapshot" && process.argv[3]) {
    const { verifyTaskSnapshot } = await import("./task-snapshot.ts");
    const snapshot = await verifyTaskSnapshot(process.argv[3]);
    console.log(
      JSON.stringify(
        { identifier: snapshot.identifier, taskContentHash: snapshot.taskContentHash },
        null,
        2,
      ),
    );
  } else {
    console.error("Unknown integration operation");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(
    redactRuntimeSecrets(error instanceof Error ? error.message : "Integration operation failed"),
  );
  process.exitCode = 1;
}
