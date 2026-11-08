# Addition smoke task

The agent fixes the exported addition function in a small JavaScript module.
The environment has Node, git, curl, and project instructions, with a five-minute agent deadline.
An independent verifier container checks JavaScript syntax and known arithmetic cases against the submitted module.
Only the module is transferred to the verifier.

Run the reference solution with `harbor run -p tasks/smoke -a oracle`.
Run the Codex example with `pnpm start run examples/codex-smoke.json` after configuring local Langfuse and the authentication-file reference.
