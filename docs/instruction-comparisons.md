# Instruction comparisons

An experiment selects a fixed task set and agent profile, then supplies explicit baseline and candidate instruction files.
The default is three attempts per task, agent, and variant.
Time limits cover the whole Harbor attempt, including setup and verification; cleanup has a short grace period.
The native agent budget is half that total, with one fifth each for agent setup and verification.
Image construction and orchestration share the remaining time and any unused phase time.
An image build or setup that exhausts the total deadline produces an interruption.
An agent that exhausts its own budget can still reach the independent verifier.
The concurrency value is an upper limit.
The Bend runner executes attempts sequentially in this release.

```sh
npm start -- plan examples/instruction-comparison.json
npm start -- run examples/instruction-comparison.json
```

The plan displays the attempt count and limits before execution.
The output directory must be new.
The runner freezes task files, instruction content, and runtime identities before starting attempts.
Changes to original or frozen inputs stop the experiment rather than silently changing a comparison.

The local JSON record preserves each attempt and the exact frozen input manifest.
The Markdown report shows per-task, per-agent, and per-variant outcomes with separate development and reserved sections.
Execution errors and interruptions stay separate from valid task failures.
Missing metrics remain unknown.
The Bend policy follows [Harbor 0.25's reward validity rules](https://github.com/harbor-framework/harbor/blob/v0.25.0/src/harbor/models/trial/error_policy.py).
Agent budget exhaustion or refusal can retain a valid verifier outcome; provider and infrastructure errors cannot.

Review the evidence before adopting a candidate.
Use only development task outcomes to choose it, then evaluate a fixed candidate on reserved tasks.
A small observed difference across three attempts does not prove a reliable improvement.
