import { fileURLToPath } from "node:url";

export function harborProgramPath(): string {
  return (
    process.env.TRUESWE_HARBOR ??
    fileURLToPath(new URL("../.tools/harbor-venv/bin/harbor", import.meta.url))
  );
}
