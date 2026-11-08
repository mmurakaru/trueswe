import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

function redirectDuplicatePathSlashes(request: IncomingMessage, response: ServerResponse): boolean {
  if (!request.url?.startsWith("//")) return false;
  request.resume();
  response.writeHead(308, { location: request.url.replace(/\/+/g, "/") });
  response.end();
  return true;
}

export async function startLocalLangfuseFixture(
  options: { observationsUnavailable?: boolean } = {},
): Promise<{
  baseUrl: string;
  traceRequests: () => number;
  tracePayloads: () => string[];
  scoreRequests: () => unknown[];
  close: () => Promise<void>;
  skillSelections: () => string[];
}> {
  let traceRequests = 0;
  const tracePayloads: string[] = [];
  const scoreRequests: unknown[] = [];
  const versions: Record<string, unknown>[] = [];
  const selections: string[] = [];
  const server = createServer(async (request, response) => {
    if (redirectDuplicatePathSlashes(request, response)) return;
    if (request.url?.startsWith("/api/public/v2/observations")) {
      request.resume();
      response.writeHead(options.observationsUnavailable ? 503 : 200, {
        "content-type": "application/json",
      });
      response.end(
        JSON.stringify(
          options.observationsUnavailable
            ? { message: "Local observation storage unavailable" }
            : { data: [], meta: {} },
        ),
      );
      return;
    }
    if (request.url === "/api/public/scores" && request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      scoreRequests.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "Accepted" }));
      return;
    }
    if (request.url?.startsWith("/api/public/skills")) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const url = new URL(request.url, "http://localhost");
      response.writeHead(200, { "content-type": "application/json" });
      if (request.method === "POST") {
        const body: { files: { path: string; content: string }[] } = JSON.parse(
          Buffer.concat(chunks).toString(),
        );
        const name = body.files
          .find((file) => file.path === "SKILL.md")
          ?.content.match(/^name: (.+)$/m)?.[1];
        const version = {
          id: `skill-${versions.length + 1}`,
          name,
          version: versions.length + 1,
          description: "Fixture skill",
          labels: ["benchmark"],
          createdAt: new Date().toISOString(),
          files: body.files.map((file, index) => ({
            path: file.path,
            content: file.content,
            id: `file-${index}`,
            blobId: `blob-${index}`,
            sha256Hash: createHash("sha256").update(file.content).digest("base64"),
            contentLength: Buffer.byteLength(file.content),
            contentType: "text/plain",
          })),
        };
        versions.push(version);
        response.end(JSON.stringify(version));
      } else if (request.method === "PATCH") {
        response.end(JSON.stringify(versions.at(-1)));
      } else {
        selections.push(url.search);
        response.end(
          JSON.stringify(
            versions.find(
              (version) => version.version === Number(url.searchParams.get("version")),
            ) ?? versions.at(-1),
          ),
        );
      }
      return;
    }
    if (request.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      tracePayloads.push(
        (request.headers["content-encoding"] === "gzip" ? gunzipSync(body) : body).toString(),
      );
      traceRequests += 1;
      response.writeHead(200);
      response.end();
    } else {
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: [{ id: "trueswe", name: "TrueSWE" }],
          meta: { page: 1, limit: 50, totalItems: 1, totalPages: 1 },
        }),
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local Langfuse fixture failed to bind");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    traceRequests: () => traceRequests,
    tracePayloads: () => tracePayloads,
    scoreRequests: () => scoreRequests,
    skillSelections: () => selections,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
