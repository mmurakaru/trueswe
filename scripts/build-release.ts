import { mkdir, readFile, writeFile, cp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest: { version: string } = JSON.parse(
  await readFile(join(projectRoot, "package.json"), "utf8"),
);
const artifactName = `trueswe-${manifest.version}-source`;
const stage = join(projectRoot, "dist", artifactName);
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await Promise.all(
  [
    "src",
    "helpers",
    "scripts",
    "tools",
    "skills",
    "docs",
    "test",
    ".changeset",
    ".oxlintrc.json",
    ".oxfmtrc.json",
    "package.json",
    "package-lock.json",
    "README.md",
    "tsconfig.json",
  ].map((entry) => cp(join(projectRoot, entry), join(stage, entry), { recursive: true })),
);
const archive = `${artifactName}.tar.gz`;
const result = spawnSync(
  "tar",
  ["-czf", join(projectRoot, "dist", archive), "-C", join(projectRoot, "dist"), artifactName],
  { stdio: "inherit" },
);
if (result.status !== 0) throw new Error("Release archive creation failed");
const digest = createHash("sha256")
  .update(await readFile(join(projectRoot, "dist", archive)))
  .digest("hex");
await writeFile(join(projectRoot, "dist", "checksums.txt"), `${digest}  ${archive}\n`);
console.log(archive);
