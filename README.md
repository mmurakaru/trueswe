# TrueSWE

Benchmark coding agents on reproducible tasks.
Compare project instructions and skills using verified outcomes and recorded runs.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.svg">
  <img src=".github/assets/banner-light.svg" alt="TrueSWE CMYK halftone orbit" width="100%">
</picture>

## Get started

Requires Node 26 LTS, pnpm 12, clang, and macOS or Linux.

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm start --help
```

See the [guide](docs/README.md) for setup and benchmark workflows.
Use `pnpm run check` to run the development checks.
