# TrueSWE

TrueSWE compares project instructions and skills on reproducible coding tasks.
Bend controls the command-line workflow.
TypeScript helpers connect Harbor, Jev, and local Langfuse.

Use Node 24.12 or later in the Node 24 series, clang, and a supported macOS or Linux host.

```sh
npm ci
npm run setup
npm start -- --help
npm run check
```

`npm run setup` downloads Bend 2.0.40 and verifies its release checksum.
`TRUESWE_BEND` can point to a compatible installed compiler.

The [specification](docs/spec.md) defines the first release.
Use the [local services guide](docs/local-services.md) to run the Codex smoke task through Harbor and Langfuse.
Repository skills live in `skills/` with upstream provenance in [docs/skill-sources.md](docs/skill-sources.md).

Contributions include a Changeset.
The release workflow prepares a version PR and publishes a checked source archive to GitHub after versioning.
The source archive requires Node, clang, and the pinned Bend compiler.
Package manifests are private.
