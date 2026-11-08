import { spawnSync } from "node:child_process";

for (const argumentsList of [
  ["venv", ".tools/harbor-venv"],
  ["pip", "install", "--python", ".tools/harbor-venv/bin/python", "harbor==0.25.0"],
]) {
  const result = spawnSync("uv", argumentsList, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
