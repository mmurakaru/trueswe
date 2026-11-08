# Native agents

Set each profile's agent, model, native version, reasoning effort, and authentication reference.
The `agents` array can select one agent or several distinct agents.
Harbor 0.25.0 installs the pinned native version in an isolated task container.
All agents use frozen inputs, an independent verifier, local records, and local Langfuse.

## Codex

The [Codex example](../examples/codex-smoke.json) uses a subscription through an existing authentication file.
For API billing, set:

```json
"authentication": {
  "method": "api-key",
  "keyEnvironment": "OPENAI_API_KEY"
}
```

## Claude Code

The [Claude example](../examples/claude-code-smoke.json) uses `ANTHROPIC_API_KEY`.
For a subscription, run this locally:

```sh
claude setup-token
```

Put the returned token in `.env` as `CLAUDE_CODE_OAUTH_TOKEN` and set:

```json
"authentication": {
  "method": "subscription",
  "tokenEnvironment": "CLAUDE_CODE_OAUTH_TOKEN"
}
```

TrueSWE forwards the selected credential and forces OAuth for subscription profiles.
The task receives a controlled `CLAUDE.md` that imports the variant's `AGENTS.md`.
Personal credentials and unselected project rules, settings, commands, agents, output styles, and MCP configuration are excluded.
Harbor uses an isolated native configuration directory.
See the [pinned Claude adapter](https://github.com/harbor-framework/harbor/blob/v0.25.0/src/harbor/agents/installed/claude_code.py).

## Grok Build

The [Grok example](../examples/grok-build-smoke.json) uses `XAI_API_KEY`.
The pinned adapter supports API keys only and rejects subscription profiles.
TrueSWE bounds background waiting and requests leftover-process cleanup.
Harbor disables native updates and telemetry.

Grok receives the selected root `AGENTS.md` and skill bundles.
Alternate root instructions and project MCP, plugin, hook, and local configuration files are excluded.
See the [native discovery rules](https://docs.x.ai/build/features/skills-plugins-marketplaces).

> [!NOTE]
> Fixture tests check integration behavior.
> A live task with the selected account is required to establish model access.
