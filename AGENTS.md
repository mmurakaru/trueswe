# TrueSWE

Use [docs/spec.md](docs/spec.md) for accepted product requirements.
Bend owns commands and experiment rules.
TypeScript helpers own external I/O and validate persisted or external data.
Run `npm run check` before committing.
Use a Changeset for each contribution; generated versions and changelogs belong to the version workflow.
Keep package manifests private and release through GitHub.

For Bend changes, read [skills/bend/SKILL.md](skills/bend/SKILL.md).
For Harbor task definitions, read [skills/create-task/SKILL.md](skills/create-task/SKILL.md).
For Jev requests, read [skills/typesafe-ai/SKILL.md](skills/typesafe-ai/SKILL.md).

Tests exercise the CLI and recorded experiment outcomes across external-tool boundaries.
Keep credentials in environment variables or files referenced by the profile.
Comments contain one line of non-obvious intent.
