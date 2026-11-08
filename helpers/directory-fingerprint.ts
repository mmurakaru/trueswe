import { readdir, readFile, stat, readlink } from "node:fs/promises";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import { hashExperimentContent } from "./experiment-record.ts";

async function fingerprintDirectoryEntries(
  directory: string,
  prefix: string,
  root: string,
): Promise<string[]> {
  const entries = (await readdir(directory, { withFileTypes: true })).toSorted((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  );
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const relativePath = `${prefix}${entry.name}`;
        const fullPath = join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          const target = await readlink(fullPath);
          const resolvedTarget = relative(root, resolve(dirname(fullPath), target));
          if (isAbsolute(target) || resolvedTarget === ".." || resolvedTarget.startsWith("../"))
            throw new Error(`Snapshot symbolic link escapes its root: ${relativePath}`);
          return [JSON.stringify(["link", relativePath, target])];
        }
        if (entry.isDirectory()) {
          const information = await stat(fullPath);
          return [JSON.stringify(["directory", relativePath, information.mode & 0o777])].concat(
            await fingerprintDirectoryEntries(fullPath, `${relativePath}/`, root),
          );
        }
        if (!entry.isFile())
          throw new Error(`Snapshot entry is not a regular file: ${relativePath}`);
        const [content, information] = await Promise.all([readFile(fullPath), stat(fullPath)]);
        return [
          JSON.stringify([
            "file",
            relativePath,
            information.mode & 0o777,
            hashExperimentContent(content),
          ]),
        ];
      }),
    )
  ).flat();
}

export async function fingerprintDirectory(directory: string): Promise<string> {
  return hashExperimentContent(
    (await fingerprintDirectoryEntries(directory, "", resolve(directory))).join("\n"),
  );
}
