# Resume an experiment

Run `npm start -- resume CONFIG` to continue the matching frozen experiment.
Completed passes and task failures remain unchanged.
Pending attempts run once.
Running attempts first recover any complete independent verifier result from disk.
Interrupted attempts and execution errors receive a new execution directory and retain their previous evidence.
A failed task is a completed result and is not retried.

The runner checks the configuration, task snapshots, instructions, selected skills, and runtime identities before resume.
Changed inputs require a separate experiment.
Only one run, resume, or recovery command can write the experiment at a time.

Interrupt with Ctrl+C or SIGTERM to preserve evidence and stop the owned Harbor process group.
Recovery removes containers selected by the execution's Compose working directories and networks selected by its recorded trial identity.
It preserves available agent logs before removing containers.
Cleanup warnings remain visible in the report.

Run `npm start -- recover CONFIG` to recover local results without starting another model attempt.
A completed experiment can be resumed repeatedly without rewriting results or exporting duplicate traces.
Previous executions and human reviews remain recorded separately.
A resumed logical attempt retains its Langfuse trace identity.
