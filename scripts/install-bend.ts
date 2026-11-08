import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import release from "../tools/bend-release.json" with { type: "json" };

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const target = `${process.platform}-${process.arch}`;
const checksum = Object.entries(release.checksums).find(([name]) => name === target)?.[1];
if (!checksum) throw new Error(`Bend platform is unsupported: ${target}`);

const toolsDirectory = resolve(projectRoot, ".tools");
await mkdir(toolsDirectory, { recursive: true });
const temporaryDirectory = await mkdtemp(join(tmpdir(), "trueswe-bend-"));
try {
  const archiveName = `bend-${release.version}-${target}.tar.gz`;
  const response = await fetch(
    `https://github.com/bendlang/bend/releases/download/v${release.version}/${archiveName}`,
    { signal: AbortSignal.timeout(120_000) },
  );
  if (!response.ok) throw new Error(`Bend download failed: HTTP ${response.status}`);
  const archivePath = join(temporaryDirectory, archiveName);
  await writeFile(archivePath, Buffer.from(await response.arrayBuffer()));
  const digest = createHash("sha256")
    .update(await readFile(archivePath))
    .digest("hex");
  if (digest !== checksum) throw new Error("Bend archive checksum mismatch");
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", toolsDirectory], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Bend archive extraction failed");
  console.log(`Installed Bend ${release.version} for ${target}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
