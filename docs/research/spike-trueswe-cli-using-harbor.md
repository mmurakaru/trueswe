# Spike: Spike: TrueSWE CLI using Harbor

## Question

How can the minimal local TrueSWE CLI, currently only a README-backed project named "TrueSWE" for building a coding-agent benchmark tool using Harbor, use Harbor to benchmark coding agents with configurable agent, model, dataset, and output directory?

## Findings

Feasibility is high for a small local CLI because Harbor already provides the core benchmark runner. Official Harbor docs define a task as an instruction, sandbox environment, and test script, and define a dataset as a collection of tasks. Harbor runs local datasets with `harbor run -p "<path/to/dataset>" -a "<agent>" -m "<model>"`, published datasets with `harbor run -d "<org>/<dataset>@<version>" -a "<agent>" -m "<model>"`, and git-backed datasets with `harbor run --repo org/repo-name -d "<dataset>" -a "<agent>" -m "<model>"`. Sources: https://www.harborframework.com/docs/datasets and https://www.harborframework.com/docs/run-jobs/run-evals.

The smallest supported TrueSWE design is a thin wrapper around `harbor run`, not a custom harness. The wrapper should validate a config file, choose exactly one dataset source, pass through `agent`, `model`, dataset flags, concurrency/attempt controls if included, and map the user-facing output directory to Harbor's local jobs directory option. Harbor's current upstream CLI source shows `harbor run` is an alias for `harbor job start`, supports `--config/-c`, `--print-config`, `--job-name`, `--jobs-dir/-o`, `--n-attempts`, `--n-concurrent`, `--agent/-a`, `--model/-m`, `--path/-p`, `--dataset/-d`, `--repo`, `--task/-t`, task include/exclude filters, environment selection, agent kwargs, agent env, verifier env, and artifact collection. Source: https://github.com/harbor-framework/harbor/blob/main/src/harbor/cli/jobs.py.

One small example task can be a single local Harbor task named `trueswe/write-hello`: instruction asks the agent to create `/app/hello.txt` containing `Hello, TrueSWE!`; `environment/Dockerfile` uses `ubuntu:24.04` with `WORKDIR /app`; `solution/solve.sh` writes the file; `tests/test.sh` checks exact content and writes `1` or `0` to `/logs/verifier/reward.txt`. This follows Harbor's official task layout: `instruction.md`, `task.toml`, `environment/Dockerfile`, `solution/solve.sh`, and `tests/test.sh`. Sources: https://www.harborframework.com/docs/tasks and https://www.harborframework.com/docs/tasks/task-tutorial.

End-to-end local commands should be documented as: install Harbor with `uv tool install harbor` or `pip install harbor`; validate available agents with `harbor agent list`; inspect an agent with `harbor agent schema <agent>`; run the oracle sanity check with `harbor run -p examples/tasks/write-hello -a oracle -o results`; run a low-cost real-agent smoke test with `OPENAI_API_KEY=... trueswe run --config trueswe.yaml`, where the wrapper executes roughly `harbor run -p examples/tasks/write-hello -a codex -m openai/gpt-5.6-luna -o results --n-concurrent 1 --n-attempts 1`. OpenAI's current model docs list `gpt-5.6-luna` as optimized for cost-sensitive workloads at $0.20 input MTok and $1.20 output MTok, making it the best fit for the requested small low-cost GPT model. Source: https://developers.openai.com/api/docs/models.

Local results should rely on Harbor's job directory format, then add a TrueSWE summary reader. Harbor docs say `harbor run` creates a job stored by default under `jobs`, with top-level `config.json` and `result.json`, and per-trial `config.json`, `result.json`, `agent/`, and `verifier/` outputs including verifier reward and stdout/stderr. The TrueSWE wrapper can save into the configured output directory via `--jobs-dir/-o`, then produce a readable summary by parsing job `result.json` plus each trial `result.json`: task name, agent, model, reward/pass status, exception if any, start/finish/duration where available, and paths to verifier logs. It should not require Harbor's web viewer, although docs say `harbor view jobs` exists for manual inspection. Source: https://www.harborframework.com/docs/run-jobs/run-evals.

Configuration validation should be intentionally narrow: require `agent`, `model`, `outputDir`, and exactly one of `dataset.path`, `dataset.name`, `dataset.repo`, or `task`; verify local paths exist for `dataset.path`; reject cloud-only flags such as `--launch` for this local-only scope; enforce positive integers for `nAttempts` and `nConcurrent`; require `OPENAI_API_KEY` when the chosen model provider is OpenAI and the agent is not `oracle`; and call Harbor's own validation with `harbor run --print-config ...` before a real run. Harbor itself validates agent kwargs against `harbor agent schema <name>` and rejects unknown or invalid agent options before starting an environment. Source: https://www.harborframework.com/docs/agents.

Test plan: unit-test config parsing and validation; unit-test Harbor command construction without executing Harbor; fixture-test summary parsing against small representative Harbor job/trial JSON files; integration-test `trueswe run --dry-run` or equivalent using `harbor run --print-config`; and, where Docker works and Harbor is installed, smoke-test the example task with `-a oracle` before any paid model run. Paid benchmark suites, Harbor Hub uploads, hosted `--launch`, cloud providers, registry publishing, and leaderboard submission were deliberately not chased in this spike. Artifact verification not performed here: no TrueSWE implementation or example files exist in the repo yet, and the spike scope forbids creating them.

## Key findings

- **TrueSWE has no existing implementation to preserve**
  The repository contains only `README.md`, whose content is a one-line product intent: `# TrueSWE` and `A project to build a coding-agent benchmark tool using Harbor.` There are no package manifests, source files, tests, or existing CLI conventions to integrate with.
- **Harbor directly supports the required benchmark dimensions**
  Official Harbor docs show local dataset runs with `harbor run -p "<path/to/dataset>" -a "<agent>" -m "<model>"`, published dataset runs with `harbor run -d "my-org/my-dataset@1.0" -a "<agent>" -m "<model>"`, and git repository datasets with `harbor run --repo org/repo-name -d "my-dataset" -a "<agent>" -m "<model>"`. Source: https://www.harborframework.com/docs/datasets.
- **Harbor already includes common coding agents and agent validation hooks**
  The Agents docs say Harbor includes pre-integrated agents including Codex CLI, Claude Code, OpenHands, Gemini CLI, and others; `harbor agent list` lists them, and `harbor agent schema <agent>` exposes accepted options, types, and defaults. The same page states Harbor rejects unknown or invalid agent options before starting an environment. Source: https://www.harborframework.com/docs/agents.
- **A minimal example task fits Harbor's standard task format**
  Harbor task docs specify that a task directory contains `instruction.md`, `task.toml`, `environment/Dockerfile`, `solution/solve.sh`, and `tests/test.sh`; tests must produce `/logs/verifier/reward.txt`. A small `write-hello` task can use this exact shape with deterministic shell verification. Sources: https://www.harborframework.com/docs/tasks and https://www.harborframework.com/docs/tasks/task-tutorial.
- **Local output can be handled by Harbor's job directory**
  Harbor eval docs state `harbor run` creates a job stored by default in `jobs`, including job-level `config.json` and `result.json`, plus per-trial result, agent, and verifier directories. Upstream CLI source shows `harbor run` / `harbor job start` accepts `--jobs-dir` / `-o` as the directory to store job results. Sources: https://www.harborframework.com/docs/run-jobs/run-evals and https://github.com/harbor-framework/harbor/blob/main/src/harbor/cli/jobs.py.
- **A readable summary should parse Harbor JSON rather than invent a second result format**
  Because Harbor already writes structured job and trial `result.json` files and verifier logs, TrueSWE can summarize task outcomes from those files while preserving Harbor's native artifacts for debugging and `harbor view`. Source: https://www.harborframework.com/docs/run-jobs/run-evals.
- **The requested low-cost GPT model should be `openai/gpt-5.6-luna` for the spike example**
  OpenAI's model docs describe `gpt-5.6-luna` as optimized for cost-sensitive workloads and list materially lower pricing than larger GPT-5.6 variants. Harbor examples use provider/model strings such as `openai/gpt-5`; therefore the Harbor-style model string for this selection should be `openai/gpt-5.6-luna`. Source: https://developers.openai.com/api/docs/models.

## Options compared

- **Use Harbor CLI/configuration directly**: This is the smallest technically supported route. It already covers agent, model, dataset, local output directory, task filtering, config files, validation via `--print-config`, native result files, and a viewer. It falls short mainly on TrueSWE-specific ergonomics: users must know Harbor flags and manually inspect/summarize JSON.
- **Build a thin TrueSWE CLI wrapper around Harbor**: This adds a small amount of product value while keeping Harbor as the source of truth. The wrapper can validate a simpler `trueswe.yaml`, invoke `harbor run`, write jobs under the requested output directory, and emit `summary.json` / `summary.md` from Harbor results. It should avoid reimplementing task execution, agent integration, sandboxing, metrics, or cloud behavior.

## Recommendation

Build the thin TrueSWE CLI wrapper, but keep it as a pass-through orchestration layer over local `harbor run`. The first version should support `agent`, `model`, exactly one dataset/task source, `outputDir`, optional `nAttempts`, optional `nConcurrent`, optional task include/exclude filters, optional agent kwargs/env, and a summary command that reads Harbor job results. Use Harbor's native task format and result directory as the durable contract.

_Confidence: 82%_

## Open questions

- Which implementation language should TrueSWE use? The repo has no package structure yet; Python would align naturally with Harbor, while Node may be preferred if the broader system expects it.
- Which agent should be the default real-agent example: `codex`/Codex CLI or Harbor's `terminus-2`? The spike evidence supports configurability, not a product default beyond oracle for no-cost validation.
- Does Harbor's installed `codex` agent require any additional local Codex configuration beyond `OPENAI_API_KEY` for `openai/gpt-5.6-luna` in this environment?
- What exact fields appear in current Harbor `result.json` for all failure modes? The summary design should be fixture-hardened once a real Harbor job is generated.
- Should TrueSWE support published Harbor datasets immediately, or start with local `--path` only and add registry/git sources after the example task is stable?
