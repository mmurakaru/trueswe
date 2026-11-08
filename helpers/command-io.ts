import { readFile } from "node:fs/promises";

if (process.argv[2] === "version") {
  const manifest: { version: string } = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  console.log(`trueswe ${manifest.version}`);
} else {
  console.error("Unknown integration operation");
  process.exitCode = 2;
}
