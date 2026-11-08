# Managed skills

Keep source bundles in Git and publish supported text bundles to local Langfuse.

## Publish and pin

```sh
pnpm start publish-skill examples/publish-bend-skill.json
```

Publication returns the name, immutable version, content hash, and source revision.
The revision is null for dirty or unversioned content.
A separate directory hash checks local files and permissions.

Set `comparisonKind` to `skills` and keep instructions identical between variants.
Each skill entry selects a name and an exact version or label:

```json
"skills": [{ "name": "bend", "version": 1 }]
```

A baseline can use `"skills": []`.
Preparation resolves labels once and freezes a complete copy for later attempts.
Instruction comparisons require identical resolved skill versions in both variants.

## Bundle limits

[Langfuse 4.76.0](https://github.com/langfuse/langfuse/blob/v4.76.0/packages/shared/src/features/skills/types.ts) accepts at most 200 files and 1,000,000 UTF-8 bytes per version.
TrueSWE checks complete bundles, supported extensions, and relative resource links before publication.
Binary files, symbolic links, empty directories, executable files, and broken links produce an error.
Use an explicit interpreter for non-executable script sources and external URLs for resources outside the bundle.

> [!NOTE]
> This server format excludes `.bend` and extensionless files such as `LICENSE`.
> Keep unsupported bundles in Git.
> TrueSWE preserves complete bundles and rejects unsupported contents without dropping or renaming files.

## Read the evidence

Selected bundles enter each native project skill directory with checksum validation.
Harbor records their digests in its job lockfile.
Reports distinguish supply, native catalog exposure, and observed reads.

An observed load requires a matched successful file read with the pinned content.
Missing success metadata, formatted output, shell mentions, or incomplete logs leave the result unknown.
A read proves access, not that the agent followed the skill.
See the [pinned Claude serializer](https://github.com/harbor-framework/harbor/blob/v0.25.0/src/harbor/agents/installed/claude_code.py) for native read evidence.
