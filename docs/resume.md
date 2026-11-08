# Resume and recovery

## Continue unfinished work

```sh
pnpm start resume CONFIG
```

Completed passes and task failures stay unchanged.
Pending attempts run once.
A running attempt first recovers any complete independent verifier result on disk.
Interrupted attempts and execution errors retain their evidence and get a new execution directory.

> [!NOTE]
> Resume requires the same frozen configuration, tasks, instructions, skills, and runtime identities.
> Changed inputs require a separate experiment.
> A completed task failure is not retried.

Only one run, resume, or recovery command can write an experiment at a time.
Repeated resume of a completed experiment preserves its records and avoids duplicate trace exports.
Retries retain the logical attempt's Langfuse identity and record separate execution and review histories.

## Stop or recover

Interrupt with Ctrl+C or SIGTERM.
The runner stops the owned Harbor process group, preserves available logs, and removes task resources selected by execution ownership.
Cleanup warnings remain in the report.

To recover local results without another model attempt:

```sh
pnpm start recover CONFIG
```
