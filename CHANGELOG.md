# trueswe

## 0.2.0

### Minor Changes

- 378ec7b: Add a Bend command-line entry, reproducible tooling, quality gates, and GitHub release versioning.
- 81c8e38: Run verified Codex tasks with local reports and Langfuse evidence.
- 24c9e61: Freeze GitHub issue tasks at fixed repository commits with independent verifier and source hashes.
- ec6aa24: Compare frozen instruction variants with repeated attempts and per-task results.
- d2bc5a2: Route bounded task evidence through Jev for unconfirmed review suggestions and record explicit human labels separately.
- 3d6d055: Publish complete skill bundles to local Langfuse and compare pinned skill versions with trace evidence.
- 17b715e: Run native Claude Code with explicit API or subscription credentials and shared verified experiment records.
- 4efe0a0: Run native Grok Build with explicit API-key profiles and shared verified task evidence.
- bf6de60: Resume unfinished experiments with preserved completed results, execution histories, and stable tracing identities.

### Patch Changes

- d58498e: Allow concurrent commands to wait for a slow cold compilation while keeping experiment writer locks nonblocking.
- c1fa0e3: Create the ignored environment file with local credentials and empty provider fields while preserving existing values.
- ec7c27f: Normalize local Langfuse URLs without a trailing slash so trace exports reach the ingestion endpoint directly.
- c132cf8: Use pnpm and the current Node LTS release across setup, validation, benchmark images, and source releases.
