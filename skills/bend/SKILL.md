---
name: bend
description: Write and validate TrueSWE Bend commands, experiment transitions, and policy functions. Use TypeScript helpers for external I/O.
---

Read the installed compiler's `bend guide` before changing Bend code.
Use `bend base Name` to inspect the version's actual library declarations.
The compiler is pinned in `tools/bend-release.json` and installed by `pnpm run setup`.
Run `pnpm run check:bend` and exercise the changed command through `pnpm start`.

Bend functions terminate and variables are affine by default.
Use explicit Data fields when copying state and match helpers when inspecting computed values.
Destructure parameters, or use `Pair.fst` and `Pair.snd` to select fields from computed pairs.
Bend owns experiment decisions; helpers return validated external facts.
`Process.run` has bounded output and timeout but does not terminate descendants.
Keep child process groups and task resource cleanup in the integration helper.

This repository skill is based on the [official guide](https://github.com/bendlang/bend/blob/v2.0.40/guide/GUIDE.md).
Managed Langfuse bundles contain supported text files; keep `.bend` source in the repository and reference it from the skill.
