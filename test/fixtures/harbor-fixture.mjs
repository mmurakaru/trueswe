#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
const configurationPath = process.argv[process.argv.indexOf("--config") + 1];
const configuration = JSON.parse(await readFile(configurationPath, "utf8"));
const fixture = JSON.parse(await readFile(process.argv[1] + ".result.json", "utf8"));
const trial = join(configuration.jobs_dir, configuration.job_name, "trial");
await mkdir(join(trial, "agent"), { recursive: true });
await writeFile(join(trial, "config.json"), "{}");
await writeFile(join(trial, "result.json"), JSON.stringify(fixture));
await writeFile(join(trial, "agent", "trajectory.json"), JSON.stringify({ steps: [] }));
