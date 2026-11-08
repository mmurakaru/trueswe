#!/usr/bin/env node
import { readFile, appendFile } from "node:fs/promises";
const fixture = await readFile(process.argv[1] + ".json", "utf8").then(JSON.parse, () => null);
if (fixture) {
  await appendFile(fixture.logPath, JSON.stringify(process.argv.slice(2)) + "\n");
  if (process.argv[2] === "ps") console.log(fixture.containers ?? "");
  if (process.argv[2] === "network" && process.argv[3] === "ls")
    console.log(fixture.networks ?? "");
}
