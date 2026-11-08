import { createServer } from "node:http";

export async function startLocalLangfuseFixture(): Promise<{
  baseUrl: string;
  traceRequests: () => number;
  close: () => Promise<void>;
}> {
  let traceRequests = 0;
  const server = createServer((request, response) => {
    request.resume();
    if (request.method === "POST") {
      traceRequests += 1;
      response.writeHead(200);
      response.end();
    } else {
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
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
