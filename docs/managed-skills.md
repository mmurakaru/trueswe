# Managed skills

Run `npm start -- publish-skill examples/publish-bend-skill.json` to publish a Git skill directory to local Langfuse.
The result includes the skill name, immutable version, source revision, and source content hash.
Labels select a version at experiment preparation.
The experiment stores that version and a complete local copy for every later attempt.

Set `comparisonKind` to `skills` and use the same instructions for both variants.
Each variant accepts `skills` entries with a `name` and either a positive `version` or a `label`.
For example, a baseline can have `skills: []` and a candidate can have `skills: [{ "name": "bend", "version": 1 }]`.
Instruction comparisons must supply the same resolved skill versions to both variants.

Langfuse 4.76.0 supports text bundles with at most 200 files and 1,000,000 UTF-8 bytes.
TrueSWE validates the complete bundle against the server file format before publication.
Unsupported files, binary data, symbolic links, and empty directories cause an error.
Relative Markdown resource links must resolve to files inside the bundle.
Use external URLs for repository resources that are outside the bundle.
Langfuse does not store executable permission bits.
Publication rejects executable source files; invoke scripts through an explicit interpreter and keep their source files non-executable.
Files are never dropped or renamed to fit the service.
An extensionless `LICENSE` file or a `.bend` source file is not supported by this server version.
Keep such bundles in Git until Langfuse supports their complete contents.

TrueSWE supplies each selected bundle to the native project skill directory and verifies file checksums during image construction.
Harbor also receives the frozen source paths and records their digests in its job lockfile.
The report records supply, native catalog exposure, and observed file loads separately.
Native catalog exposure remains unknown without evidence from the agent.
A load requires a matched successful file read whose content matches the pinned file.
Missing success metadata, formatted output, shell command mentions, and incomplete logs leave load evidence unknown.
An observed file read does not prove that the agent followed the instructions.

The file format comes from [Langfuse 4.76.0](https://github.com/langfuse/langfuse/blob/v4.76.0/packages/shared/src/features/skills/types.ts).
Read evidence follows the [Harbor 0.25.0 Claude serializer](https://github.com/harbor-framework/harbor/blob/v0.25.0/src/harbor/agents/installed/claude_code.py).
