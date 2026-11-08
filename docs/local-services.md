# Local setup

Requires Docker, the Node LTS and pnpm versions pinned in the repository, and the compiler prerequisites in the [README](../README.md).

## Start

```sh
pnpm run setup:env
pnpm run services:up
pnpm run setup:harbor
pnpm start plan examples/codex-smoke.json
pnpm start run examples/codex-smoke.json
```

`setup:env` creates the ignored `.env` with generated local credentials and empty provider fields.
Repeat it to add missing fields while preserving existing values.
[`.env.example`](../.env.example) lists the fields with empty values.

> [!NOTE]
> Keep tokens in `.env` or the process environment.
> The Codex example references an existing authentication file; setup stores its path, not its contents.
> See [native agents](native-agents.md) for API-key and subscription profiles.

## Langfuse

Open [local Langfuse](http://localhost:3035).
Sign in as `developer@trueswe.local` with `LANGFUSE_LOCAL_PASSWORD` from `.env`.
Enable Skill Management in account Feature Preview, and V4 Preview if the interface requests it.

The Compose project runs Langfuse 4.76.0 with persistent PostgreSQL, ClickHouse, Redis, and MinIO volumes.
Only loopback ports 3035 and 3036 are published.
Image digests follow the [official deployment](https://github.com/langfuse/langfuse/blob/v4.76.0/docker-compose.yml).
The runner checks local readiness before starting work.

## Stop

```sh
pnpm run services:down
```

Volumes and experiment results are preserved.
Use `TRUESWE_HARBOR` to select another compatible Harbor executable.
