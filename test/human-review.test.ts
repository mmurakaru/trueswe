import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, cp, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchExperimentCommand } from "./command-test-support.ts";
import { startLocalLangfuseFixture } from "./local-langfuse-test-support.ts";
import type { ExperimentRecord } from "../helpers/experiment-record.ts";
import type { ReviewRecord } from "../helpers/review-record.ts";

test("Jev suggestions and explicit human labels preserve verified outcomes and redact bounded evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trueswe-review-"));
  const langfuse = await startLocalLangfuseFixture();
  const received: string[] = [];
  let confidence = 0.9;
  let apiFailure = false;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    received.push(Buffer.concat(chunks).toString());
    assert.equal(request.url, "/v1/systemone");
    response.writeHead(apiFailure ? 503 : 200, { "content-type": "application/json" });
    response.end(
      JSON.stringify(
        apiFailure
          ? { error: "Review service unavailable" }
          : {
              model: "jev-fixture-resolved",
              answers: {
                reviewCategory: {
                  type: "choice",
                  choice: "wrong-path",
                  confidence,
                  probabilities: {
                    "wrong-path": confidence,
                    "tool-failure": (1 - confidence) / 4,
                    "missing-context": (1 - confidence) / 4,
                    "task-misunderstanding": (1 - confidence) / 4,
                    none: (1 - confidence) / 4,
                  },
                },
              },
              usage: { input_tokens: 12, output_tokens: 2 },
            },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("TypeSafe fixture did not bind");
    const helper = join(directory, "harbor-fixture");
    await cp("test/fixtures/harbor-fixture.mjs", helper);
    await chmod(helper, 0o700);
    const authenticationFile = join(directory, "codex-auth.json");
    const fileToken = "fixture-auth-file-credential";
    const routerToken = "fixture-router-credential";
    await writeFile(authenticationFile, JSON.stringify({ tokens: { access_token: fileToken } }));
    await writeFile(
      helper + ".result.json",
      JSON.stringify({
        exception_info: null,
        verifier_environment_mode: "separate",
        verifier_result: { rewards: { reward: 1 } },
        agent_result: null,
        trajectory: {
          steps: [
            {
              step_id: 1,
              source: "agent",
              message: "Recorded context ".repeat(3000) + fileToken + " " + routerToken,
              tool_calls: [
                { tool_call_id: "tool-1", function_name: "exec", arguments: { input: "false" } },
              ],
              observation: { results: [{ source_call_id: "tool-1", content: "Exit code 1" }] },
            },
          ],
        },
      }),
    );
    const configuration = JSON.parse(await readFile("examples/codex-smoke.json", "utf8"));
    configuration.outputDirectory = join(directory, "experiment");
    configuration.langfuse.baseUrl = langfuse.baseUrl;
    const configurationPath = join(directory, "experiment.json");
    await writeFile(configurationPath, JSON.stringify(configuration));
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      TRUESWE_HARBOR: helper,
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      TRUESWE_CODEX_AUTH_FILE: authenticationFile,
      CUSTOM_ROUTER_AUTH: routerToken,
      TYPESAFE_BASE_URL: `http://127.0.0.1:${address.port}`,
    };
    const execution = await launchExperimentCommand(["run", configurationPath], environment);
    assert.equal(execution.status, 0, execution.output);
    const recordPath = join(configuration.outputDirectory, "experiment.json");
    const original: ExperimentRecord = JSON.parse(await readFile(recordPath, "utf8"));
    const identifier = original.attempts[0]!.identifier;
    const requestPath = join(directory, "review.json");
    await writeFile(
      requestPath,
      JSON.stringify({
        schemaVersion: 1,
        experimentConfigurationPath: configurationPath,
        attemptIdentifier: identifier,
        model: "jev-fixture-requested",
        keyEnvironment: "CUSTOM_ROUTER_AUTH",
      }),
    );
    const reviewPath = join(configuration.outputDirectory, "reviews", `${identifier}.json`);
    const suggested = await launchExperimentCommand(["review", requestPath], environment);
    assert.equal(suggested.status, 0, suggested.output);
    let review: ReviewRecord = JSON.parse(await readFile(reviewPath, "utf8"));
    assert.equal(review.status, "suggested");
    assert.equal(review.decision, null);
    assert.equal(review.judgments[0]?.modelIdentity, "jev-fixture-resolved");
    assert.equal(review.judgments[0]?.category, "wrong-path");
    assert.equal(review.judgments[0]?.exportError, null);
    assert.equal(received.length, 1);
    assert.ok(Buffer.byteLength(received[0]!) <= 32_000);
    assert.ok(!received[0]!.includes(fileToken));
    assert.ok(!received[0]!.includes(routerToken));
    assert.match(received[0]!, /REDACTED/);
    assert.ok(!JSON.stringify(review).includes(fileToken));
    assert.ok(!JSON.stringify(review).includes(routerToken));
    assert.equal(original.attempts[0]?.outcome, "pass");
    const labelPath = join(directory, "label.json");
    const label = {
      schemaVersion: 1,
      experimentConfigurationPath: configurationPath,
      attemptIdentifier: identifier,
      decision: "accept",
      category: "wrong-path",
      evidenceReference: "trajectory:step:1",
      explanation: "A human checked the recorded approach.",
    };
    await writeFile(labelPath, JSON.stringify(label));
    const accepted = await launchExperimentCommand(["label", labelPath], environment);
    assert.equal(accepted.status, 0, accepted.output);
    review = JSON.parse(await readFile(reviewPath, "utf8"));
    assert.equal(review.decision?.status, "accepted");
    assert.equal(review.decision?.category, "wrong-path");
    assert.equal(review.exportError, null);
    label.decision = "change";
    label.category = "missing-context";
    label.explanation = `A human identified missing information; ${fileToken}`;
    await writeFile(labelPath, JSON.stringify(label));
    const changed = await launchExperimentCommand(["label", labelPath], environment);
    assert.equal(changed.status, 0, changed.output);
    review = JSON.parse(await readFile(reviewPath, "utf8"));
    assert.equal(review.decisions.length, 2);
    assert.equal(review.decision?.category, "missing-context");
    assert.ok(!JSON.stringify(review).includes(fileToken));
    const scores = langfuse.scoreRequests().flat() as { id: string; name: string; value: string }[];
    const humanScores = scores.filter((score) => score.name === "human-review-decision");
    assert.equal(humanScores.length, 2);
    assert.equal(humanScores[0]?.id, humanScores[1]?.id);
    assert.equal(humanScores[1]?.value, "missing-context");
    confidence = 0.55;
    const uncertain = await launchExperimentCommand(["review", requestPath], environment);
    assert.equal(uncertain.status, 0, uncertain.output);
    review = JSON.parse(await readFile(reviewPath, "utf8"));
    assert.equal(review.status, "manual-review");
    assert.equal(review.judgments.length, 2);
    assert.equal(review.decision?.category, "missing-context");
    apiFailure = true;
    const unavailable = await launchExperimentCommand(["review", requestPath], environment);
    assert.equal(unavailable.status, 0, unavailable.output);
    review = JSON.parse(await readFile(reviewPath, "utf8"));
    assert.equal(review.status, "manual-review");
    assert.match(review.judgments.at(-1)?.error ?? "", /unavailable/);
    assert.equal(received.length, 3);
    label.decision = "reject";
    await writeFile(labelPath, JSON.stringify(label));
    const rejected = await launchExperimentCommand(["label", labelPath], environment);
    assert.equal(rejected.status, 0, rejected.output);
    review = JSON.parse(await readFile(reviewPath, "utf8"));
    assert.equal(review.decision?.category, null);
    assert.equal(review.decisions.length, 3);
    assert.equal(review.judgments[0]?.category, "wrong-path");
    const listed = await launchExperimentCommand(["reviews", configurationPath], environment);
    assert.equal(listed.status, 0, listed.output);
    assert.equal(JSON.parse(listed.output)[0].judgments.length, 3);
    assert.deepEqual(JSON.parse(await readFile(recordPath, "utf8")).attempts, original.attempts);
    const report = await readFile(join(configuration.outputDirectory, "report.md"), "utf8");
    assert.match(report, /Human decision: rejected. Accepted category: none/);
    label.decision = "accept";
    label.evidenceReference = "trajectory:step:999";
    await writeFile(labelPath, JSON.stringify(label));
    const invalid = await launchExperimentCommand(["label", labelPath], environment);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.output, /recorded evidence reference/);
  } finally {
    await langfuse.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
