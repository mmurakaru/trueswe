# Task snapshots

Use `npm start -- snapshot REQUEST.json` to freeze a GitHub issue, repository commit, and Harbor task template.
Store request files and snapshots under the ignored `results/` directory when they contain private inputs.

A request contains:

```json
{
  "schemaVersion": 1,
  "identifier": "example-task",
  "repositoryDirectory": ".",
  "repositoryUrl": "https://github.com/example/project",
  "startingCommit": "0000000000000000000000000000000000000000",
  "prerequisiteCommits": [],
  "issueUrl": "https://github.com/example/project/issues/1",
  "taskTemplateDirectory": "tasks/example-template",
  "split": "development",
  "previousEvaluationExposure": "No evaluation runs have been used to select a candidate.",
  "outputDirectory": "results/snapshots/example-task"
}
```

Replace the example commit with a full commit identifier.
Each prerequisite commit must be an ancestor of the starting commit.
The working directory may have unrelated edits; the snapshot contains only the chosen commit's tracked files.

The template defines the agent image, separate verifier image, artifact transfer, and task-specific checks.
It must build its workspace from `environment/repository`, where the chosen Git archive is extracted.
Authoritative verifier files stay under `tests/`, outside the agent image.
Task authors verify that the reference solution passes and unchanged code fails.

The snapshot records issue text and discussion, source hashes, task and verifier content hashes, split membership, and prior evaluation exposure.
An existing snapshot is never overwritten.
Use a new output directory to capture changed inputs.

To run a snapshot, set the experiment task path to its `task` subdirectory and its identifier and split to the snapshot metadata.
The runner verifies the snapshot before starting an attempt.
Keep development and reserved task manifests separate when choosing an improvement.
