import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { hashExperimentContent } from "./experiment-record.ts";

async function fingerprintDirectoryEntries(directory: string, prefix: string): Promise<string[]> {
  const entries = (await readdir(directory, { withFileTypes: true })).toSorted((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const relativePath = `${prefix}${entry.name}`;
        const fullPath = join(directory, entry.name);
        if (entry.isSymbolicLink())
          throw new Error(`Snapshot symbolic links are unsupported: ${relativePath}`);
        if (entry.isDirectory()) return fingerprintDirectoryEntries(fullPath, `${relativePath}/`);
        if (!entry.isFile())
          throw new Error(`Snapshot entry is not a regular file: ${relativePath}`);
        const [content, information] = await Promise.all([readFile(fullPath), stat(fullPath)]);
        return [
          JSON.stringify([relativePath, information.mode & 0o111, hashExperimentContent(content)]),
        ];
      }),
    )
  ).flat();
}

export async function fingerprintDirectory(directory: string): Promise<string> {
  return hashExperimentContent((await fingerprintDirectoryEntries(directory, "")).join("\n"));
}
