# Local services

The Compose project runs Langfuse 4.76.0 with persistent PostgreSQL, ClickHouse, Redis, and MinIO volumes.
Image digests follow the [official release deployment](https://github.com/langfuse/langfuse/blob/v4.76.0/docker-compose.yml).
Only local loopback ports 3035 and 3036 are published.

```sh
npm run services:configure
npm run services:up
npm run setup:harbor
npm start -- plan examples/codex-smoke.json
npm start -- run examples/codex-smoke.json
```

Configuration creates a private, ignored `.env` with generated local credentials.
It stores only the path to the existing Codex authentication file.
The runner reads that path and lets Harbor's native adapter use it.
The adapter temporarily makes the credentials available inside the agent sandbox.
Use `TRUESWE_HARBOR` to select another compatible Harbor executable.

Open Langfuse at `http://localhost:3035`.
The local account is `developer@trueswe.local`; its password is the `LANGFUSE_LOCAL_PASSWORD` value in `.env`.
Enable Skill Management under account Feature Preview, and V4 Preview if requested by that UI.

The smoke task uses a separate verifier container.
Only the submitted addition module crosses into that container.
The agent receives no authoritative verifier code.

Run `npm run services:down` to stop this project's services while preserving data.
The deployment has no remote endpoint or failover.
