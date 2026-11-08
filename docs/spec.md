# TrueSWE specification

TrueSWE measures how project instructions and agent skills affect coding-task completion.
The first release serves one developer working on their own repositories through a local command-line interface.
The user reviews recorded evidence and decides whether to adopt a change.

## Release scope

- Bend is the main language and controls commands, experiment state, and experiment rules.
- TypeScript helpers integrate with the Harbor CLI, TypeSafe SDK, local Langfuse, and external JSON formats.
- Harbor supplies isolated task execution and native Codex, Claude Code, and Grok Build adapters.
- Local Langfuse supplies traces, experiment links, and native Skill Management.
- All three coding agents work in the first release; each experiment selects its agents.
- API keys work for all three agents.
- Codex and Claude Code also support their available subscription authentication paths.
- Grok subscription authentication is outside this release because the inspected Harbor adapter requires an API key.
- The initial live check uses Codex subscription authentication.
- JSON records and Markdown reports remain available locally.
- Oxlint checks TypeScript, and automated versioning produces GitHub releases without npm publication.

> [!NOTE]
> TrueSWE is a local CLI; Langfuse supplies its local interface.
> Hosted services, remote failover, historical-session imports, automatic code changes, and code-structure benchmarks are outside scope.

## Architecture

Bend owns command selection, experiment transitions, and policy.
TypeScript helpers perform bounded external I/O and return validated facts through Bend's process interface.

The TypeScript Harbor helper invokes the installed Harbor command with literal arguments and a configuration file.
Harbor remains an external Python runtime dependency; TrueSWE application code uses Bend and TypeScript.
Process cleanup covers descendants and Harbor resources because Bend's process timeout alone does not terminate descendant processes.
Helpers have bounded output and time limits.

The TypeSafe helper sends bounded evidence excerpts to Jev.
The Langfuse helper addresses only a configured local instance and records project and object identifiers.
Selected dependency versions are verified against current official sources before installation and locked for reproducible setup.

## Task snapshots

Use reproducible TrueSWE implementation issues as task candidates.
Collect at least two development tasks and two reserved evaluation tasks.

Each task snapshot contains a stable identifier, source issue URL and text, repository URL, exact starting commit, environment definition, success checks, and content hashes.
A task may have a different starting commit from another task.
Required dependencies must already exist at that commit.
Task execution uses an isolated checkout, separate from the active runner and the user's working tree.

Task-specific checks and required repository checks must both pass.
The evaluated agent cannot edit the authoritative verifier or active experiment records.
Reference checks run in an independent verifier environment against the submitted task artifacts.
The agent's statements about completion do not determine success.

Only development-run evidence may guide a candidate instruction or skill change.
Freeze the candidate before executing reserved evaluation tasks.
The report records dataset membership and any prior reserved-task exposure.
The reserved set is a separate measurement set, not a claim that issue descriptions were secret.
An edited task or verifier creates a new snapshot rather than changing a recorded experiment.

## Experiments

An experiment records its schema version, selected agents, explicit models, agent versions, reasoning settings, authentication methods, task snapshots, variants, repetitions, limits, and output location.
Authentication records identify methods and secret references, not secret contents.
Resolve and record exact versions before starting attempts.
Resolve labels to exact skill versions once when the experiment is frozen.

A comparison contains baseline and candidate variants.
It changes either instruction content or the skill set, while other inputs remain fixed within each agent's comparison.
Instruction comparisons supply explicit baseline and candidate project instructions through each agent's supported project instruction surface.
Personal configuration is excluded while the selected project instructions remain available.
Skill comparisons change a pinned set, a version, or the presence of a skill.

The default is three independent attempts for every task, agent, and variant combination.
An experiment can configure the repetition count.
Time and concurrency limits are explicit required inputs.
The plan displays its complete attempt count before execution.
Attempts and infrastructure retries are distinct concepts.
Task failures are not retried automatically.

Each attempt has a stable identity and records whether it is pending, running, completed, interrupted, or affected by an execution error.
A valid failed task is distinct from an unavailable agent, invalid verifier reward, missing result, or broken environment.
Completed attempts survive interruption.
Explicit resume verifies the frozen experiment identity and schedules unfinished work without replacing completed records.

## Local Langfuse and skills

Supply a documented local deployment based on official Langfuse Compose guidance, with persistent storage and the services required for tracing and Skill Management.
Verify the chosen server and TypeScript SDK together because Skill Management is a preview feature.
The command checks that the configured local service is ready before starting.
There is no remote fallback or separate outage-management subsystem.
Completed local attempt evidence remains readable after interruption.

Keep skill source folders in Git under `skills/`.
Copy the official TypeSafe skill and Harbor task-authoring skill with their licenses, support files, source revisions, and provenance.
Create a small local Bend skill based on the official language guide because the inspected Bend repository has no official skill file.
The local Bend skill uses supported documentation files and references repository Bend source when needed.

Publish complete supported skill bundles to local Langfuse.
Fetch exact versions for task environments and preserve the supplied files, hashes, and Harbor lockfile provenance.
Reject unsupported files and incomplete bundles with actionable errors; never silently omit or rename resources.
Current Langfuse constraints include supported text extensions, at most 200 files, and at most 1,000,000 UTF-8 bytes per version.
The inspected extension list excludes `.bend`.
Compatibility checks use the installed server's actual capabilities.

Every attempt records its available skill catalog and exact versions.
Record successful skill-file loads when agent tool events or explicit instrumentation provide evidence.
Keep availability, observed loads, and missing evidence separate in local records, Langfuse, and reports.
Unknown load status is not treated as proof that the agent ignored a skill.
A successful file load is not proof that the agent followed the instructions.
An outer wrapper trace alone does not establish activity inside an agent container.

## Jev and human review

Jev routes recorded evidence into review categories: tool failure, wrong path, missing context, and task misunderstanding.
It does not choose which agent runs a task or change benchmark pass/fail outcomes.
Persist the request configuration, bounded evidence references, returned category and confidence, and model identity.
Do not treat a nonzero tool result by itself as a confirmed harmful error.

Evidence may include repository code and bounded excerpts of instructions, tool calls, and outputs.
Remove known credentials before transmission and record the submitted evidence locally without secret values.
If Jev fails or cannot make a useful judgment, keep the benchmark result and send the evidence for manual review.
Only human confirmation creates an accepted failure label.

Provide a command that lists suggestions and lets the user accept, change, or reject them.
Each accepted label includes a category, a trajectory or event reference, and the user's explanation.
Preserve suggestions separately from accepted labels.
Link human review and Jev judgments to the corresponding local and Langfuse attempt records.

## Reports and evidence

Write versioned JSON experiment records and a readable Markdown report.
Show task and agent outcomes, attempt counts, passes, task failures, execution errors, interruptions, and missing evidence.
Show time and available token or cost data without inventing missing values.
Report baseline and candidate results per task and agent, with development and reserved evaluation results kept distinct.
Include links to trajectories, labels, exact task snapshots, instruction variants, supplied skill versions, observed loads, and local Langfuse records.

The user decides whether to adopt the candidate.
A higher observed pass rate on separate real tasks is the intended evidence of improvement.
Three repetitions are an initial view of variation, not proof that a small difference is statistically reliable.
The release must produce correct comparisons even when the candidate does not improve results.

## Quality and releases

Run strict TypeScript checks, oxlint, formatting, meaningful tests, and Bend validation locally and in CI.
Use Changesets for versioning.
Verify versions of dependencies and GitHub Actions against their official registries or upstream releases before pinning.
Keep package manifests private and provide no npm publish command or workflow.

Contributions carry a Changeset, including an empty Changeset for documentation or CI-only work when applicable.
Generated version and changelog updates come from the release process.
The version workflow opens a release PR.
A merged version update produces a tagged GitHub release with tested source/runtime artifacts and checksums as appropriate to the selected Bend runtime.
Release artifacts must include the required TypeScript helper runtime or document and validate its dependency.
Never describe a source bundle as a standalone binary.

Each implementation issue follows the ship workflow through tests, independent code review, comment trimming, a review-ready PR, and CI.
Commits use the user's configured identity without attribution trailers.
PRs use the repository's template.
Publishing a release requires completed acceptance checks.

## Release acceptance

- A Bend command executes a complete Codex task using the existing subscription and writes verified local and Langfuse results.
- Claude Code and Grok Build execute the same benchmark workflow through their native Harbor adapters.
- At least two development tasks and two reserved tasks have reproducible, independent verifiers and fixed source snapshots.
- An instruction experiment and a skill experiment each preserve all fixed inputs and report baseline/candidate results.
- Supplied skill versions and any observed loads have distinct evidence in the report.
- Jev suggestions reach human review without determining task success.
- Explicit resume preserves completed attempts and refuses changed experiment inputs.
- Timeouts, invalid rewards, missing metrics, unsupported skill bundles, and unavailable credentials produce clear outcomes.
- Local checks and CI pass; the version workflow creates GitHub release artifacts without npm publication.

## Verified references

- [Harbor jobs](https://docs.harborframework.com/jobs/run-a-job)
- [Harbor task format](https://docs.harborframework.com/tasks/overview)
- [Independent verification](https://docs.harborframework.com/tasks/separate-verifier)
- [Harbor agent capabilities](https://docs.harborframework.com/agents/pre-integrated-agents)
- [Harbor skills](https://docs.harborframework.com/jobs/skills)
- [Bend language guide](https://github.com/bendlang/bend/blob/9a4223d577ba56a0cb53d1fd952d2b481c38930f/guide/GUIDE.md)
- [TypeSafe TypeScript SDK](https://docs.typesafe.ai/sdk/javascript)
- [Jev with coding agents](https://docs.typesafe.ai/introduction/coding-agents)
- [Langfuse Skill Management](https://langfuse.com/docs/skill-management/overview)
- [Langfuse skill tracing](https://langfuse.com/docs/skill-management/tracing)
- [Langfuse self-hosting](https://langfuse.com/self-hosting/deployment/docker-compose)

Sources checked on 2026-11-08.
