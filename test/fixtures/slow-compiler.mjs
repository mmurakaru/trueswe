#!/usr/bin/env node
import { appendFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const counterPath = process.env.TRUESWE_COMPILATION_COUNTER;
const compilerPath = process.env.TRUESWE_REAL_BEND;
if (!counterPath || !compilerPath) throw new Error("Compiler fixture configuration is missing");
if (process.argv.includes("-o")) {
  const firstCompilation = !existsSync(counterPath);
  appendFileSync(counterPath, "compile\n");
  if (firstCompilation) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 17000);
}
const result = spawnSync(compilerPath, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);
