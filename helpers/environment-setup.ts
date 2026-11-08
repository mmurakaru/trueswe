import { randomBytes } from "node:crypto";
import { readFile, writeFile, appendFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { withFileRecordLock } from "./file-record-lock.ts";

const secret = () => randomBytes(32).toString("hex");

export async function configureLocalEnvironment(path: string): Promise<void> {
  await withFileRecordLock(path, async () => {
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
      CLAUDE_CODE_OAUTH_TOKEN: "",
      ANTHROPIC_API_KEY: "",
      XAI_API_KEY: "",
      TYPESAFE_API_KEY: "",
      OPENAI_API_KEY: "",
    };
    let current: string | null = null;
    try {
      current = await readFile(path, "utf8");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const missing = Object.entries(values).filter(
      ([name]) => !new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`, "m").test(current ?? ""),
    );
    const addition = missing
      .map(([name, value]) => `${name}=${value ? JSON.stringify(value) : ""}`)
      .join("\n");
    if (current === null) await writeFile(path, addition + "\n", { mode: 0o600, flag: "wx" });
    else if (missing.length > 0)
      await appendFile(path, (current.endsWith("\n") ? "" : "\n") + addition + "\n");
    await chmod(path, 0o600);
  });
}
