# Native agents

Each experiment supplies an explicit agent name, model, version, reasoning effort, and authentication reference.
Select one agent or several distinct agents in the `agents` array.
Harbor 0.25.0 installs the requested native agent version in the task environment.
Every agent uses the same independent verifier, frozen inputs, attempt records, and local Langfuse export.

## Codex

Use `examples/codex-smoke.json` for a subscription profile.
Its credential reference points to an existing Codex authentication file.
For an API key, use `authentication: { "method": "api-key", "keyEnvironment": "OPENAI_API_KEY" }`.

## Claude Code

Use `examples/claude-code-smoke.json` for an API-key profile.
Put the referenced key in the ignored `.env` file or the process environment.
For a supported subscription, use `authentication: { "method": "subscription", "tokenEnvironment": "CLAUDE_CODE_OAUTH_TOKEN" }`.
Obtain the subscription token through `claude setup-token` and store it in the referenced environment variable.
TrueSWE forwards only the selected credential and forces OAuth for a subscription profile.
It does not import personal keychain credentials or unrelated provider keys.

The task root receives a controlled `CLAUDE.md` that imports the variant's `AGENTS.md`.
Task-root local Claude instructions, project rules, commands, agent definitions, output styles, settings, and MCP configuration are excluded from the native run.
Harbor uses an isolated Claude configuration directory inside the attempt environment.
The selected project skills remain available through the experiment's skill treatment.

API and subscription tests use a deterministic process fixture when real credentials are unavailable.
A passing fixture test establishes integration behavior; it does not establish account access to the configured model.

Authentication behavior follows the [pinned Harbor Claude adapter](https://github.com/harbor-framework/harbor/blob/v0.25.0/src/harbor/agents/installed/claude_code.py).
