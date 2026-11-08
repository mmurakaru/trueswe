import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, resolve, extname, dirname, posix } from "node:path";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import * as validation from "valibot";
import format from "../tools/langfuse-skill-format.json" with { type: "json" };
import {
  localLangfuseConnectionSchema,
  hashExperimentContent,
  managedSkillNameSchema,
} from "./experiment-record.ts";
import type { ExperimentConfiguration, FrozenExperimentInputs } from "./experiment-record.ts";
import { localLangfuseClient, checkLocalLangfuse } from "./local-langfuse.ts";
import { fingerprintDirectory } from "./directory-fingerprint.ts";
import { runExternalProcess } from "./child-process-io.ts";

const textFileSchema = validation.strictObject({
  path: validation.string(),
  content: validation.string(),
});
const frontmatterSchema = validation.object({
  name: managedSkillNameSchema,
  description: validation.pipe(validation.string(), validation.minLength(1)),
});
const publishRequestSchema = validation.strictObject({
  schemaVersion: validation.literal(1),
  skillDirectory: validation.string(),
  langfuse: localLangfuseConnectionSchema,
  labels: validation.optional(validation.array(validation.string()), []),
  commitMessage: validation.optional(validation.string(), "Publish a complete skill bundle"),
});
type ManagedSkillFiles = validation.InferOutput<typeof textFileSchema>[];

function validateManagedSkillLinks(files: ManagedSkillFiles, paths: Set<string>): void {
  for (const file of files.filter((item) =>
    [".md", ".markdown", ".mdx"].includes(extname(item.path)),
  )) {
    const pending: Nodes[] = [fromMarkdown(file.content)];
    const links: string[] = [];
    while (pending.length > 0) {
      const node = pending.pop();
      if (!node) continue;
      if ("children" in node) pending.push(...node.children);
      if (["link", "image", "definition"].includes(node.type) && "url" in node)
        links.push(node.url);
    }
    for (const target of links) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
      let decoded: string;
      try {
        decoded = decodeURIComponent(target.split(/[?#]/)[0] ?? "");
      } catch {
        throw new Error(`Managed skill resource link is malformed: ${file.path} -> ${target}`);
      }
      const path = posix.normalize(posix.join(posix.dirname(file.path), decoded));
      if (decoded.startsWith("/") || !paths.has(path))
        throw new Error(
          `Managed skill support file is missing or outside the bundle: ${file.path} -> ${target}`,
        );
    }
  }
}

function validateManagedSkillFiles(files: ManagedSkillFiles): {
  name: string;
  description: string;
} {
  if (files.length === 0 || files.length > 200)
    throw new Error("Managed skill bundles require one to 200 files");
  const paths = new Set<string>();
  let bytes = 0;
  for (const file of files) {
    if (
      file.path.startsWith("/") ||
      file.path.includes("\\") ||
      file.path.split("/").some((part) => !part || part === "." || part === "..") ||
      Array.from(file.path).some((character) => character.charCodeAt(0) < 32)
    )
      throw new Error("Managed skill file path is invalid");
    if (paths.has(file.path)) throw new Error(`Managed skill file is duplicated: ${file.path}`);
    paths.add(file.path);
    if (!format.extensions.includes(extname(file.path).toLowerCase()))
      throw new Error(
        `Managed skill file type is unsupported by Langfuse ${format.version}: ${file.path}. Files are never silently dropped or renamed.`,
      );
    if (file.content.includes("\0"))
      throw new Error(`Managed skill file contains binary data: ${file.path}`);
    bytes += Buffer.byteLength(file.content);
  }
  if (bytes > 1_000_000) throw new Error("Managed skill bundle exceeds 1000000 UTF-8 bytes");
  validateManagedSkillLinks(files, paths);
  const entry = files.find((file) => file.path === "SKILL.md");
  const header = entry?.content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!header) throw new Error("Managed skill requires a root SKILL.md with YAML frontmatter");
  return validation.parse(frontmatterSchema, parseYaml(header));
}

async function collectManagedSkillFiles(
  directory: string,
  prefix = "",
  budget = { files: 0, bytes: 0 },
): Promise<ManagedSkillFiles> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length === 0)
    throw new Error("Managed skill bundles cannot preserve empty directories");
  if (entries.length > 200) throw new Error("Managed skill bundle exceeds the file limit");
  const groups = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))
        throw new Error("Managed skill resources must be regular files or directories");
      const relativePath = `${prefix}${entry.name}`;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectManagedSkillFiles(path, `${relativePath}/`, budget);
      if (!format.extensions.includes(extname(relativePath).toLowerCase()))
        throw new Error(
          `Managed skill file type is unsupported by Langfuse ${format.version}: ${relativePath}`,
        );
      budget.files += 1;
      const metadata = await stat(path);
      if ((metadata.mode & 0o111) !== 0)
        throw new Error(
          `Langfuse cannot preserve executable permissions: ${relativePath}. Use an explicit interpreter and a non-executable source file.`,
        );
      budget.bytes += metadata.size;
      if (budget.files > 200 || budget.bytes > 1_000_000)
        throw new Error("Managed skill bundle exceeds its file or byte limit");
      const bytes = await readFile(path);
      const content = bytes.toString("utf8");
      if (!Buffer.from(content).equals(bytes))
        throw new Error(`Managed skill file is not valid UTF-8: ${relativePath}`);
      return [{ path: relativePath, content }];
    }),
  );
  return groups
    .flat()
    .toSorted((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

export async function publishManagedSkill(
  requestPath: string,
): Promise<{ name: string; version: number; contentHash: string; sourceRevision: string | null }> {
  const request = validation.parse(
    publishRequestSchema,
    JSON.parse(await readFile(requestPath, "utf8")),
  );
  if (request.labels.includes("latest"))
    throw new Error("Langfuse manages the latest label automatically");
  const files = (await collectManagedSkillFiles(resolve(request.skillDirectory))).toSorted(
    (left, right) => left.path.localeCompare(right.path),
  );
  const metadata = validateManagedSkillFiles(files);
  const revision = await runExternalProcess(
    "git",
    ["-C", resolve(request.skillDirectory), "rev-parse", "HEAD"],
    { PATH: process.env.PATH, HOME: process.env.HOME },
    5000,
  );
  const status = await runExternalProcess(
    "git",
    [
      "-C",
      resolve(request.skillDirectory),
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ".",
    ],
    { PATH: process.env.PATH, HOME: process.env.HOME },
    5000,
  );
  const sourceRevision =
    revision.status === 0 && status.status === 0 && !status.output.trim()
      ? revision.output.trim()
      : null;
  await checkLocalLangfuse(request);
  const client = localLangfuseClient(request);
  const published = await client.api.skills.createVersion(
    {
      files,
      commitMessage: `${request.commitMessage}\nSource revision: ${sourceRevision ?? "unversioned"}\nContent SHA-256: ${hashExperimentContent(JSON.stringify(files))}`,
    },
    { timeoutInSeconds: 15, maxRetries: 0 },
  );
  if (published.name !== metadata.name)
    throw new Error("Published skill name does not match its source frontmatter");
  if (
    published.files.length !== files.length ||
    published.files.some((file) => {
      const source = files.find((item) => item.path === file.path);
      return (
        !source ||
        file.sha256Hash !== createHash("sha256").update(source.content).digest("base64") ||
        file.contentLength !== Buffer.byteLength(source.content)
      );
    })
  )
    throw new Error("Published skill manifest does not preserve the complete source bundle");
  if (request.labels.length > 0)
    await client.api.skills.setLabels(
      published.name,
      published.version,
      { labels: request.labels },
      { timeoutInSeconds: 10, maxRetries: 0 },
    );
  return {
    name: published.name,
    version: published.version,
    contentHash: hashExperimentContent(JSON.stringify(files)),
    sourceRevision,
  };
}

export function frozenSkillDirectory(
  configuration: ExperimentConfiguration,
  variantName: string,
  name: string,
): string {
  return resolve(configuration.outputDirectory, "frozen", "skills", variantName, name);
}

export async function freezeManagedSkills(
  configuration: ExperimentConfiguration,
): Promise<FrozenExperimentInputs["skills"]> {
  const client = localLangfuseClient(configuration);
  const groups = await Promise.all(
    configuration.variants.map(async (variant) => {
      const names = variant.skills.map((skill) => skill.name);
      if (new Set(names).size !== names.length)
        throw new Error("A variant cannot contain duplicate skill names");
      return Promise.all(
        variant.skills.map(async (selection) => {
          const selector =
            "version" in selection ? { version: selection.version } : { label: selection.label };
          const skill = await client.api.skills.get(
            selection.name,
            { ...selector, includeContent: true },
            { timeoutInSeconds: 10, maxRetries: 0 },
          );
          const files = skill.files.map((file) => {
            if (file.content === undefined)
              throw new Error("Langfuse returned an incomplete skill bundle");
            const digest = createHash("sha256").update(file.content).digest("base64");
            if (
              digest !== file.sha256Hash ||
              Buffer.byteLength(file.content) !== file.contentLength
            )
              throw new Error("Langfuse skill file content does not match its manifest");
            return { path: file.path, content: file.content };
          });
          const metadata = validateManagedSkillFiles(files);
          if (
            skill.name !== selection.name ||
            metadata.name !== selection.name ||
            !Number.isInteger(skill.version) ||
            skill.version < 1 ||
            ("version" in selection && skill.version !== selection.version)
          )
            throw new Error("Resolved skill identity does not match its selector");
          const directory = frozenSkillDirectory(configuration, variant.name, skill.name);
          await mkdir(directory, { recursive: true });
          await Promise.all(
            files.map(async (file) => {
              const path = join(directory, file.path);
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, file.content);
            }),
          );
          return {
            variantName: variant.name,
            name: skill.name,
            version: skill.version,
            contentHash: hashExperimentContent(
              JSON.stringify(files.toSorted((left, right) => left.path.localeCompare(right.path))),
            ),
            directoryHash: await fingerprintDirectory(directory),
            files: skill.files.map((file) => ({ path: file.path, sha256Hash: file.sha256Hash })),
          };
        }),
      );
    }),
  );
  return groups.flat();
}
