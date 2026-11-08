import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const secret = () => randomBytes(32).toString("hex");
const values = {
  POSTGRES_PASSWORD: secret(),
  CLICKHOUSE_PASSWORD: secret(),
  REDIS_AUTH: secret(),
  MINIO_ROOT_PASSWORD: secret(),
  SALT: secret(),
  ENCRYPTION_KEY: secret(),
  NEXTAUTH_SECRET: secret(),
  LANGFUSE_PUBLIC_KEY: `pk-lf-${secret()}`,
  LANGFUSE_SECRET_KEY: `sk-lf-${secret()}`,
  LANGFUSE_LOCAL_PASSWORD: secret(),
  LANGFUSE_BASE_URL: "http://127.0.0.1:3035",
  TRUESWE_CODEX_AUTH_FILE: resolve(homedir(), ".codex/auth.json"),
};
await writeFile(
  new URL("../.env", import.meta.url),
  Object.entries(values)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join("\n") + "\n",
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Created .env with local credentials and the Codex authentication-file reference. Existing credentials are never overwritten.",
);
