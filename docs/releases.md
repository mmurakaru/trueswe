# Releases

Contributions include a Changeset and pass the repository checks and independent code review.
The version workflow opens a draft version PR.
Merging the version update builds a tagged GitHub source archive and checksums.
Package manifests remain private; publication uses GitHub releases.

## Version PR checks

Set `RELEASE_TOKEN` to a GitHub token with repository-content and pull-request write access to trigger normal CI on the version PR.
With the default `GITHUB_TOKEN`, a maintainer approves trusted version-branch workflow runs.
See [GitHub's workflow event rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow).

> [!IMPORTANT]
> Complete [release acceptance](spec.md#release-acceptance) before marking the draft ready.
> Pending Changesets skip artifact setup and build work.

## Use a source archive

Install the Node LTS version in `.node-version` and the pnpm version in `package.json`, then run:

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm start --version
```

The archive contains source and TypeScript helpers; it requires these runtimes.
