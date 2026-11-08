import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { lock } from "proper-lockfile";

export async function withFileRecordLock<T>(
  path: string,
  operation: () => Promise<T>,
  wait = true,
): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const release = await lock(path, {
    realpath: false,
    stale: 60_000,
    update: 5000,
    retries: wait ? { retries: 600, minTimeout: 100, maxTimeout: 100, factor: 1 } : 0,
  });
  try {
    return await operation();
  } finally {
    await release();
  }
}
