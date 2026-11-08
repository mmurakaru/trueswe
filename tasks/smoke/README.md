# Addition smoke task

The agent fixes an exported JavaScript addition function.
A separate verifier checks syntax and known arithmetic cases against the submitted module.
Only that module crosses into the verifier environment.

## Run

```sh
harbor run -p tasks/smoke -a oracle
pnpm start run examples/codex-smoke.json
```

The benchmark command requires [local services and authentication](../../docs/local-services.md).
The experiment profile sets the overall deadline.
