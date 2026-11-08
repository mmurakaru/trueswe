# Instruction comparisons

A comparison holds the tasks and agent profiles fixed while changing project instructions between baseline and candidate.
The default is three attempts per task, agent, and variant.

## Run

```sh
pnpm start plan examples/instruction-comparison.json
pnpm start run examples/instruction-comparison.json
```

The plan shows the attempt count and limits.
Use a new output directory.
Preparation freezes task files, instruction content, skill versions, and runtime identities.
Changed inputs stop execution.
To continue the same experiment, use [resume](resume.md).

## Limits and outcomes

The total deadline includes image construction, setup, agent work, and verification.
The agent receives half the total; setup and verification each receive one fifth.
Image construction and orchestration share the remaining time and unused phase time.
Attempts run sequentially within the configured concurrency limit.

An agent timeout or refusal can retain an independent verifier result under [Harbor's reward policy](https://github.com/harbor-framework/harbor/blob/v0.25.0/src/harbor/models/trial/error_policy.py).
Provider errors, invalid results, and interruptions remain separate from task failures.
The JSON record preserves evidence and the frozen manifest; the Markdown report compares outcomes by task, agent, variant, and dataset split.
Missing metrics stay unknown.

> [!NOTE]
> Use development results to choose a candidate, then freeze it before reserved evaluation.
> Three attempts show variation; a small difference does not establish a reliable improvement.
> The user decides whether to adopt the candidate.
